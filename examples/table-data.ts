export const powerRows = [
  { item: "Iron ore", machine: "Miner", rate: "60 / min" },
  { item: "Iron ingot", machine: "Smelter", rate: "30 / min" },
  { item: "Iron plate", machine: "Constructor", rate: "20 / min" },
] as const

export const powerColumns = [
  { type: "px" as const, value: 138 },
  { type: "px" as const, value: 230 },
  { type: "px" as const, value: 122 },
]
