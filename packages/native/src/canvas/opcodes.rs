//! Canonical Canvas 2D binary command table.
//!
//! The transport is deliberately split into three arrays:
//!
//! - `ops: Uint32Array` starts with [`STREAM_MAGIC`], [`STREAM_VERSION`], then
//!   one `(opcode, operand_arity)` pair per command.
//! - `operands: Float64Array` concatenates each command's operands in order.
//! - `strings: string[]` is the side table for strings and opaque handles.
//!   An operand documented as a side-table slot is an exact, non-negative
//!   integer index into this array.
//!
//! Every command carries its arity in the stream so a newer writer can be read
//! by an older decoder: unknown opcodes are skipped without losing framing and
//! produce a loud element-scoped diagnostic. Known fixed-arity commands reject
//! an arity mismatch as malformed. `SetLineDash` is the only variable-arity
//! command in version 1.
//!
//! `packages/react/src/canvas/opcodes.ts` mirrors the numeric constants for the
//! phase-A2 recorder. Change both files in the same commit.

pub const STREAM_MAGIC: u32 = 0x4758_4332; // ASCII "GXC2"
pub const STREAM_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OperandArity {
    Fixed(u32),
    Variable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OpcodeSpec {
    pub code: u32,
    pub name: &'static str,
    pub arity: OperandArity,
    /// Operand positions that index the string/handle side table.
    pub side_table_slots: &'static [u8],
}

pub const SAVE: u32 = 0x01;
pub const RESTORE: u32 = 0x02;

pub const TRANSLATE: u32 = 0x10;
pub const SCALE: u32 = 0x11;
pub const ROTATE: u32 = 0x12;
pub const TRANSFORM: u32 = 0x13;
pub const SET_TRANSFORM: u32 = 0x14;
pub const RESET_TRANSFORM: u32 = 0x15;

pub const FILL_STYLE: u32 = 0x20;
pub const STROKE_STYLE: u32 = 0x21;
pub const LINE_WIDTH: u32 = 0x22;
pub const GLOBAL_ALPHA: u32 = 0x23;
pub const LINE_CAP: u32 = 0x24;
pub const LINE_JOIN: u32 = 0x25;
pub const MITER_LIMIT: u32 = 0x26;
pub const SET_LINE_DASH: u32 = 0x27;
pub const LINE_DASH_OFFSET: u32 = 0x28;

pub const FILL_RECT: u32 = 0x30;
pub const STROKE_RECT: u32 = 0x31;
pub const CLEAR_RECT: u32 = 0x32;

pub const BEGIN_PATH: u32 = 0x40;
pub const MOVE_TO: u32 = 0x41;
pub const LINE_TO: u32 = 0x42;
pub const BEZIER_CURVE_TO: u32 = 0x43;
pub const QUADRATIC_CURVE_TO: u32 = 0x44;
pub const ARC: u32 = 0x45;
pub const ARC_TO: u32 = 0x46;
pub const ELLIPSE: u32 = 0x47;
pub const RECT: u32 = 0x48;
pub const CLOSE_PATH: u32 = 0x49;
/// One numeric fill-rule operand: 0 = nonzero, 1 = evenodd.
pub const FILL: u32 = 0x4a;
pub const STROKE: u32 = 0x4b;

/// `(handle_slot, dx, dy)`.
pub const DRAW_IMAGE_3: u32 = 0x50;
/// `(handle_slot, dx, dy, dw, dh)`.
pub const DRAW_IMAGE_5: u32 = 0x51;
/// `(handle_slot, sx, sy, sw, sh, dx, dy, dw, dh)`.
pub const DRAW_IMAGE_9: u32 = 0x52;

const NONE: &[u8] = &[];
const SLOT_0: &[u8] = &[0];

/// Version-1 opcode contract. This is the canonical documentation for the
/// recorder and decoder; order is grouped for readability, not wire semantics.
pub const OPCODE_TABLE: &[OpcodeSpec] = &[
    OpcodeSpec {
        code: SAVE,
        name: "save",
        arity: OperandArity::Fixed(0),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: RESTORE,
        name: "restore",
        arity: OperandArity::Fixed(0),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: TRANSLATE,
        name: "translate",
        arity: OperandArity::Fixed(2),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: SCALE,
        name: "scale",
        arity: OperandArity::Fixed(2),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: ROTATE,
        name: "rotate",
        arity: OperandArity::Fixed(1),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: TRANSFORM,
        name: "transform",
        arity: OperandArity::Fixed(6),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: SET_TRANSFORM,
        name: "setTransform",
        arity: OperandArity::Fixed(6),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: RESET_TRANSFORM,
        name: "resetTransform",
        arity: OperandArity::Fixed(0),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: FILL_STYLE,
        name: "fillStyle",
        arity: OperandArity::Fixed(1),
        side_table_slots: SLOT_0,
    },
    OpcodeSpec {
        code: STROKE_STYLE,
        name: "strokeStyle",
        arity: OperandArity::Fixed(1),
        side_table_slots: SLOT_0,
    },
    OpcodeSpec {
        code: LINE_WIDTH,
        name: "lineWidth",
        arity: OperandArity::Fixed(1),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: GLOBAL_ALPHA,
        name: "globalAlpha",
        arity: OperandArity::Fixed(1),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: LINE_CAP,
        name: "lineCap",
        arity: OperandArity::Fixed(1),
        side_table_slots: SLOT_0,
    },
    OpcodeSpec {
        code: LINE_JOIN,
        name: "lineJoin",
        arity: OperandArity::Fixed(1),
        side_table_slots: SLOT_0,
    },
    OpcodeSpec {
        code: MITER_LIMIT,
        name: "miterLimit",
        arity: OperandArity::Fixed(1),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: SET_LINE_DASH,
        name: "setLineDash",
        arity: OperandArity::Variable,
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: LINE_DASH_OFFSET,
        name: "lineDashOffset",
        arity: OperandArity::Fixed(1),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: FILL_RECT,
        name: "fillRect",
        arity: OperandArity::Fixed(4),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: STROKE_RECT,
        name: "strokeRect",
        arity: OperandArity::Fixed(4),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: CLEAR_RECT,
        name: "clearRect",
        arity: OperandArity::Fixed(4),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: BEGIN_PATH,
        name: "beginPath",
        arity: OperandArity::Fixed(0),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: MOVE_TO,
        name: "moveTo",
        arity: OperandArity::Fixed(2),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: LINE_TO,
        name: "lineTo",
        arity: OperandArity::Fixed(2),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: BEZIER_CURVE_TO,
        name: "bezierCurveTo",
        arity: OperandArity::Fixed(6),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: QUADRATIC_CURVE_TO,
        name: "quadraticCurveTo",
        arity: OperandArity::Fixed(4),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: ARC,
        name: "arc",
        arity: OperandArity::Fixed(6),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: ARC_TO,
        name: "arcTo",
        arity: OperandArity::Fixed(5),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: ELLIPSE,
        name: "ellipse",
        arity: OperandArity::Fixed(8),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: RECT,
        name: "rect",
        arity: OperandArity::Fixed(4),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: CLOSE_PATH,
        name: "closePath",
        arity: OperandArity::Fixed(0),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: FILL,
        name: "fill",
        arity: OperandArity::Fixed(1),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: STROKE,
        name: "stroke",
        arity: OperandArity::Fixed(0),
        side_table_slots: NONE,
    },
    OpcodeSpec {
        code: DRAW_IMAGE_3,
        name: "drawImage(3)",
        arity: OperandArity::Fixed(3),
        side_table_slots: SLOT_0,
    },
    OpcodeSpec {
        code: DRAW_IMAGE_5,
        name: "drawImage(5)",
        arity: OperandArity::Fixed(5),
        side_table_slots: SLOT_0,
    },
    OpcodeSpec {
        code: DRAW_IMAGE_9,
        name: "drawImage(9)",
        arity: OperandArity::Fixed(9),
        side_table_slots: SLOT_0,
    },
];

pub fn spec(code: u32) -> Option<&'static OpcodeSpec> {
    OPCODE_TABLE.iter().find(|spec| spec.code == code)
}
