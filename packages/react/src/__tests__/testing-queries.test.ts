import { describe, expect, it } from "vitest"
import {
  getAllByText,
  getByText,
  getChildren,
  getParent,
  queryByText,
  textContent,
  within,
  type TestElement,
  type TestRenderer,
} from "../testing.js"

function createElementTable() {
  const elements = new Map<number, TestElement>([
    [
      1,
      {
        id: 1,
        type: "div",
        style: {},
        text: null,
        events: new Set(),
        children: [2, 5],
        parentId: null,
        dataTestId: "page",
      },
    ],
    [
      2,
      {
        id: 2,
        type: "div",
        style: {},
        text: null,
        events: new Set(),
        children: [3, 4],
        parentId: 1,
        dataTestId: "summary",
      },
    ],
    [
      3,
      { id: 3, type: "text", style: {}, text: "Ore", events: new Set(), children: [], parentId: 2 },
    ],
    [
      4,
      { id: 4, type: "text", style: {}, text: "Rate", events: new Set(), children: [], parentId: 2 },
    ],
    [
      5,
      {
        id: 5,
        type: "div",
        style: {},
        text: null,
        events: new Set(),
        children: [6, 7],
        parentId: 1,
        dataTestId: "details",
      },
    ],
    [
      6,
      {
        id: 6,
        type: "text",
        style: {},
        text: "Ore rate",
        events: new Set(),
        children: [],
        parentId: 5,
      },
    ],
    [
      7,
      {
        id: 7,
        type: "text",
        style: {},
        text: "Mossy stone",
        events: new Set(),
        children: [],
        parentId: 5,
      },
    ],
  ])
  const renderer = {
    getRoot: () => elements.get(1),
    getElement: (id: number) => elements.get(id),
  } as TestRenderer

  return { renderer, elements }
}

describe("Testing Library-style text queries", () => {
  it("finds exact text and text descendants through the element table", () => {
    const { elements, renderer } = createElementTable()
    const page = elements.get(1)
    const summary = elements.get(2)
    const details = elements.get(5)

    expect(page).toBeDefined()
    expect(summary).toBeDefined()
    expect(details).toBeDefined()
    expect(getByText(renderer, "Ore rate").text).toBe("Ore rate")
    expect(getByText(renderer, /mossy/i).text).toBe("Mossy stone")
    expect(queryByText(renderer, "Absent")).toBeUndefined()
    expect(getAllByText(renderer, /Ore/).map((element) => element.text)).toEqual(["Ore", "Ore rate"])
    expect(within(renderer, summary!).getAllByText(/./).map((element) => element.text)).toEqual([
      "Ore",
      "Rate",
    ])
    expect(within(renderer, details!).queryByText("Ore")).toBeUndefined()
    expect(textContent(renderer, summary!)).toBe("OreRate")
    expect(getChildren(renderer, page!)).toEqual([summary, details])
    expect(getParent(renderer, summary!)).toEqual(page)
  })

  it("reports nearby rendered text when an exact match is absent", () => {
    const { renderer } = createElementTable()

    expect(() => getByText(renderer, "Moss")).toThrowError(
      /Unable to find an element with text "Moss".*Near misses:\n.*<text#3>: "Ore".*<text#4>: "Rate".*<text#6>: "Ore rate".*<text#7>: "Mossy stone"/s
    )
  })

  it("reports the matcher and matching elements when text is ambiguous", () => {
    const { renderer } = createElementTable()

    expect(() => getByText(renderer, /Ore/)).toThrowError(
      /Found multiple elements with text \/Ore\/:\n  <text#3>\n  <text#6>/
    )
    expect(() => queryByText(renderer, /Ore/)).toThrowError("Found multiple elements")
  })
})
