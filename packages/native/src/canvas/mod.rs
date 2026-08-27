//! Retained Canvas 2D display lists and typed-array transport decoder.

pub mod opcodes;

use std::fmt;
use std::sync::{Arc, Mutex};

use rustc_hash::FxHashMap;

pub type SharedDisplayLists = Arc<Mutex<FxHashMap<u64, Arc<DisplayList>>>>;

#[derive(Clone, Debug, PartialEq)]
pub struct FillRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub color: gpui::Rgba,
}

#[derive(Clone, Debug, PartialEq)]
pub enum DisplayItem {
    FillRect(FillRect),
}

#[derive(Clone, Debug)]
pub struct DisplayList {
    pub revision: u64,
    pub items: Vec<DisplayItem>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CanvasDiagnostic {
    pub op_index: usize,
    pub op_name: String,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecodeError {
    pub op_index: Option<usize>,
    pub reason: String,
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.op_index {
            Some(index) => write!(f, "canvas command op {index}: {}", self.reason),
            None => write!(f, "canvas command stream: {}", self.reason),
        }
    }
}

impl std::error::Error for DecodeError {}

pub(crate) struct DecodedDisplayList {
    items: Vec<DisplayItem>,
    pub(crate) diagnostics: Vec<CanvasDiagnostic>,
    invalidates: bool,
    ignored_empty_restore: bool,
}

#[derive(Debug)]
pub(crate) struct CanvasApplyOutcome {
    pub diagnostics: Vec<CanvasDiagnostic>,
    pub invalidates: bool,
}

#[derive(Clone)]
struct ReplayState {
    fill_style: gpui::Rgba,
}

fn malformed(op_index: usize, reason: impl Into<String>) -> DecodeError {
    DecodeError {
        op_index: Some(op_index),
        reason: reason.into(),
    }
}

fn side_table_index(
    value: f64,
    op_index: usize,
    operand_index: usize,
) -> Result<usize, DecodeError> {
    if !value.is_finite() || value < 0.0 || value.fract() != 0.0 || value > usize::MAX as f64 {
        return Err(malformed(
            op_index,
            format!("operand {operand_index} must be an exact non-negative side-table index, got {value}"),
        ));
    }
    Ok(value as usize)
}

pub(crate) fn decode(
    ops: &[u32],
    operands: &[f64],
    strings: &[String],
) -> Result<DecodedDisplayList, DecodeError> {
    if ops.len() < 2 {
        return Err(DecodeError {
            op_index: None,
            reason: format!("expected magic and version header, got {} words", ops.len()),
        });
    }
    if ops[0] != opcodes::STREAM_MAGIC {
        return Err(DecodeError {
            op_index: None,
            reason: format!("invalid magic 0x{:08x}", ops[0]),
        });
    }
    if ops[1] != opcodes::STREAM_VERSION {
        return Err(DecodeError {
            op_index: None,
            reason: format!(
                "unsupported version {}; expected {}",
                ops[1],
                opcodes::STREAM_VERSION
            ),
        });
    }

    let mut op_cursor = 2usize;
    let mut operand_cursor = 0usize;
    let mut op_index = 0usize;
    let mut state = ReplayState {
        fill_style: crate::color::parse_color_rgba("#000000").expect("black is valid"),
    };
    let mut stack = Vec::new();
    let mut items = Vec::new();
    let mut diagnostics = Vec::new();
    let mut invalidates = false;
    let mut ignored_empty_restore = false;

    while op_cursor < ops.len() {
        if ops.len() - op_cursor < 2 {
            return Err(malformed(
                op_index,
                "opcode header is truncated; expected opcode and arity",
            ));
        }
        let code = ops[op_cursor];
        let arity = ops[op_cursor + 1] as usize;
        op_cursor += 2;

        let operand_end = operand_cursor
            .checked_add(arity)
            .ok_or_else(|| malformed(op_index, "operand arity overflowed the stream index"))?;
        if operand_end > operands.len() {
            return Err(malformed(
                op_index,
                format!(
                    "declares {arity} operands but only {} remain",
                    operands.len().saturating_sub(operand_cursor)
                ),
            ));
        }
        let command_operands = &operands[operand_cursor..operand_end];
        operand_cursor = operand_end;

        let Some(spec) = opcodes::spec(code) else {
            diagnostics.push(CanvasDiagnostic {
                op_index,
                op_name: format!("unknown(0x{code:08x})"),
                reason: format!(
                    "opcode 0x{code:08x} is not defined by canvas stream version {}",
                    opcodes::STREAM_VERSION
                ),
            });
            op_index += 1;
            continue;
        };

        if let opcodes::OperandArity::Fixed(expected) = spec.arity {
            if arity != expected as usize {
                return Err(malformed(
                    op_index,
                    format!(
                        "{} declares arity {arity}; version {} requires {expected}",
                        spec.name,
                        opcodes::STREAM_VERSION
                    ),
                ));
            }
        }

        for &slot in spec.side_table_slots {
            let slot = usize::from(slot);
            let index = side_table_index(command_operands[slot], op_index, slot)?;
            if index >= strings.len() {
                return Err(malformed(
                    op_index,
                    format!(
                        "{} operand {slot} references side-table slot {index}, but the table has {} entries",
                        spec.name,
                        strings.len()
                    ),
                ));
            }
        }

        match code {
            opcodes::SAVE => stack.push(state.clone()),
            opcodes::RESTORE => {
                if let Some(restored) = stack.pop() {
                    state = restored;
                } else {
                    ignored_empty_restore = true;
                }
                // Canvas restore() on an empty stack is an observable no-op.
            }
            opcodes::FILL_STYLE => {
                let index = side_table_index(command_operands[0], op_index, 0)?;
                let value = &strings[index];
                if let Some(color) = crate::color::parse_color_rgba(value) {
                    state.fill_style = color;
                } else {
                    diagnostics.push(CanvasDiagnostic {
                        op_index,
                        op_name: spec.name.to_string(),
                        reason: format!("unsupported Canvas 2D color {value:?}"),
                    });
                }
            }
            opcodes::FILL_RECT => {
                if command_operands.iter().all(|value| value.is_finite()) {
                    items.push(DisplayItem::FillRect(FillRect {
                        x: command_operands[0],
                        y: command_operands[1],
                        width: command_operands[2],
                        height: command_operands[3],
                        color: state.fill_style,
                    }));
                    invalidates = true;
                }
                // Browser Canvas treats non-finite rectangle arguments as a no-op.
            }
            _ => diagnostics.push(CanvasDiagnostic {
                op_index,
                op_name: spec.name.to_string(),
                reason: "recognized by stream version 1 but not implemented in canvas phase A1"
                    .to_string(),
            }),
        }

        op_index += 1;
    }

    if operand_cursor != operands.len() {
        return Err(malformed(
            op_index,
            format!(
                "{} trailing operands are not owned by an opcode",
                operands.len() - operand_cursor
            ),
        ));
    }

    Ok(DecodedDisplayList {
        items,
        diagnostics,
        invalidates,
        ignored_empty_restore,
    })
}

pub(crate) fn install_decoded_display_list(
    display_lists: &SharedDisplayLists,
    element_id: u64,
    decoded: DecodedDisplayList,
) -> CanvasApplyOutcome {
    let DecodedDisplayList {
        items,
        diagnostics,
        invalidates,
        ignored_empty_restore,
    } = decoded;
    if !invalidates {
        return CanvasApplyOutcome {
            diagnostics,
            invalidates: false,
        };
    }
    let mut lists = display_lists.lock().unwrap();
    if ignored_empty_restore
        && lists
            .get(&element_id)
            .is_some_and(|list| list.items == items)
    {
        return CanvasApplyOutcome {
            diagnostics,
            invalidates: false,
        };
    }
    let revision = lists
        .get(&element_id)
        .map_or(1, |list| list.revision.saturating_add(1));
    lists.insert(element_id, Arc::new(DisplayList { revision, items }));
    CanvasApplyOutcome {
        diagnostics,
        invalidates: true,
    }
}

#[cfg(test)]
pub fn replace_display_list(
    display_lists: &SharedDisplayLists,
    element_id: u64,
    ops: &[u32],
    operands: &[f64],
    strings: &[String],
) -> Result<CanvasApplyOutcome, DecodeError> {
    Ok(install_decoded_display_list(
        display_lists,
        element_id,
        decode(ops, operands, strings)?,
    ))
}

pub fn remove_display_lists(display_lists: &SharedDisplayLists, element_ids: &[u64]) {
    let mut lists = display_lists.lock().unwrap();
    for id in element_ids {
        lists.remove(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stream(commands: &[(u32, &[f64])]) -> (Vec<u32>, Vec<f64>) {
        let mut ops = vec![opcodes::STREAM_MAGIC, opcodes::STREAM_VERSION];
        let mut operands = Vec::new();
        for (opcode, values) in commands {
            ops.extend([*opcode, values.len() as u32]);
            operands.extend_from_slice(values);
        }
        (ops, operands)
    }

    #[test]
    fn decoder_round_trips_fill_style_and_fill_rect() {
        let (ops, operands) = stream(&[
            (opcodes::FILL_STYLE, &[0.0]),
            (opcodes::FILL_RECT, &[12.0, 18.0, 40.0, 24.0]),
        ]);
        let store = SharedDisplayLists::default();
        let outcome = replace_display_list(&store, 7, &ops, &operands, &["#2563eb".into()])
            .expect("valid stream");

        assert!(outcome.diagnostics.is_empty());
        assert!(outcome.invalidates);
        let list = store.lock().unwrap().get(&7).unwrap().clone();
        assert_eq!(list.revision, 1);
        let DisplayItem::FillRect(rect) = &list.items[0];
        assert_eq!(
            (rect.x, rect.y, rect.width, rect.height),
            (12.0, 18.0, 40.0, 24.0)
        );
        assert_eq!(
            u32::from(rect.color),
            u32::from(crate::color::parse_color_rgba("#2563eb").unwrap())
        );

        replace_display_list(&store, 7, &ops, &operands, &["#2563eb".into()])
            .expect("valid replacement");
        assert_eq!(store.lock().unwrap().get(&7).unwrap().revision, 2);
    }

    #[test]
    fn decoder_replays_the_fill_style_save_restore_stack() {
        let (ops, operands) = stream(&[
            (opcodes::FILL_STYLE, &[0.0]),
            (opcodes::SAVE, &[]),
            (opcodes::FILL_STYLE, &[1.0]),
            (opcodes::FILL_RECT, &[0.0, 0.0, 10.0, 10.0]),
            (opcodes::RESTORE, &[]),
            (opcodes::FILL_RECT, &[10.0, 0.0, 10.0, 10.0]),
        ]);
        let store = SharedDisplayLists::default();
        let outcome = replace_display_list(
            &store,
            8,
            &ops,
            &operands,
            &["#ef4444".into(), "#2563eb".into()],
        )
        .expect("valid stream");

        assert!(outcome.diagnostics.is_empty());
        let list = store.lock().unwrap().get(&8).unwrap().clone();
        assert_eq!(list.items.len(), 2);
        let DisplayItem::FillRect(first) = &list.items[0];
        let DisplayItem::FillRect(second) = &list.items[1];
        assert_eq!(
            u32::from(first.color),
            u32::from(crate::color::parse_color_rgba("#2563eb").unwrap())
        );
        assert_eq!(
            u32::from(second.color),
            u32::from(crate::color::parse_color_rgba("#ef4444").unwrap())
        );
    }

    #[test]
    fn restore_on_an_empty_stack_is_not_a_diagnostic() {
        let (ops, operands) = stream(&[(opcodes::RESTORE, &[])]);
        let store = SharedDisplayLists::default();

        let outcome = replace_display_list(&store, 10, &ops, &operands, &[])
            .expect("restore on an empty stack is valid");

        assert!(outcome.diagnostics.is_empty());
        assert!(!outcome.invalidates);
        assert!(!store.lock().unwrap().contains_key(&10));
    }

    #[test]
    fn trailing_restore_on_an_empty_stack_does_not_bump_the_display_list() {
        let store = SharedDisplayLists::default();
        let (first_ops, first_operands) =
            stream(&[(opcodes::FILL_RECT, &[0.0, 0.0, 10.0, 10.0])]);
        replace_display_list(&store, 11, &first_ops, &first_operands, &[])
            .expect("initial drawing is valid");

        let (restored_ops, restored_operands) = stream(&[
            (opcodes::FILL_RECT, &[0.0, 0.0, 10.0, 10.0]),
            (opcodes::RESTORE, &[]),
        ]);
        let outcome = replace_display_list(&store, 11, &restored_ops, &restored_operands, &[])
            .expect("restore on an empty stack is valid");

        assert!(outcome.diagnostics.is_empty());
        assert!(!outcome.invalidates);
        assert_eq!(store.lock().unwrap().get(&11).unwrap().revision, 1);
    }

    #[test]
    fn known_and_unknown_unimplemented_opcodes_decode_with_diagnostics() {
        let (ops, operands) = stream(&[
            (opcodes::TRANSLATE, &[4.0, 8.0]),
            (0xffff, &[1.0, 2.0, 3.0]),
        ]);
        let store = SharedDisplayLists::default();
        let outcome = replace_display_list(&store, 9, &ops, &operands, &[]).unwrap();
        assert_eq!(outcome.diagnostics.len(), 2);
        assert_eq!(outcome.diagnostics[0].op_name, "translate");
        assert_eq!(outcome.diagnostics[1].op_name, "unknown(0x0000ffff)");
        assert!(!outcome.invalidates);
        assert!(!store.lock().unwrap().contains_key(&9));
    }

    #[test]
    fn malformed_streams_are_rejected_by_op_index_without_replacing_the_list() {
        let store = SharedDisplayLists::default();
        let (valid_ops, valid_operands) = stream(&[(opcodes::FILL_RECT, &[0.0, 0.0, 1.0, 1.0])]);
        replace_display_list(&store, 3, &valid_ops, &valid_operands, &[]).unwrap();

        let cases = [
            (
                vec![
                    opcodes::STREAM_MAGIC,
                    opcodes::STREAM_VERSION,
                    opcodes::FILL_RECT,
                ],
                vec![],
                "opcode header is truncated",
            ),
            (
                vec![
                    opcodes::STREAM_MAGIC,
                    opcodes::STREAM_VERSION,
                    opcodes::FILL_RECT,
                    3,
                ],
                vec![0.0, 0.0, 1.0],
                "declares arity 3",
            ),
            (
                vec![
                    opcodes::STREAM_MAGIC,
                    opcodes::STREAM_VERSION,
                    opcodes::FILL_RECT,
                    4,
                ],
                vec![0.0, 0.0],
                "only 2 remain",
            ),
        ];

        for (ops, operands, message) in cases {
            let error = replace_display_list(&store, 3, &ops, &operands, &[]).unwrap_err();
            assert_eq!(error.op_index, Some(0));
            assert!(error.reason.contains(message), "{}", error.reason);
            assert_eq!(store.lock().unwrap().get(&3).unwrap().revision, 1);
        }
    }

    #[test]
    fn malformed_header_side_table_and_trailing_operands_are_rejected() {
        let store = SharedDisplayLists::default();
        let header =
            replace_display_list(&store, 1, &[opcodes::STREAM_MAGIC], &[], &[]).unwrap_err();
        assert_eq!(header.op_index, None);

        let (ops, operands) = stream(&[(opcodes::FILL_STYLE, &[2.0])]);
        let side = replace_display_list(&store, 1, &ops, &operands, &["red".into()]).unwrap_err();
        assert_eq!(side.op_index, Some(0));

        let trailing = replace_display_list(
            &store,
            1,
            &[opcodes::STREAM_MAGIC, opcodes::STREAM_VERSION],
            &[1.0],
            &[],
        )
        .unwrap_err();
        assert_eq!(trailing.op_index, Some(0));
    }
}
