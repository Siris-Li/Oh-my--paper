export type WeaponType = "blade" | "bow" | "hammer" | "shield" | "spear";

export const WEAPON_PIXEL_GRIDS: Record<WeaponType, string[]> = {
  blade: [
    "..............#.",
    ".............##.",
    "............##=.",
    "...........##=..",
    "..........##=...",
    ".........##=....",
    "........##=.....",
    ".......##=......",
    "......##=.......",
    ".....##=........",
    "....##=.........",
    "...##==.........",
    "..#####.........",
    ".##=##..........",
    ".#=.............",
    "................",
  ],
  bow: [
    "....#...........",
    "...##...........",
    "..##...........=",
    ".##...........=.",
    ".#...........=..",
    "#...........=...",
    "#..........=....",
    "#.........=.....",
    "#.........=.....",
    "#..........=....",
    "#...........=...",
    ".#...........=..",
    ".##...........=.",
    "..##...........=",
    "...##...........",
    "....#...........",
  ],
  hammer: [
    "................",
    "....#######.....",
    "...#########....",
    "...##=====##....",
    "...##=====##....",
    "...#########....",
    "....#######.....",
    "......###.......",
    "......###.......",
    "......###.......",
    "......###.......",
    "......###.......",
    "......###.......",
    "......###.......",
    "......#=........",
    "................",
  ],
  shield: [
    "................",
    "....########....",
    "...##########...",
    "..############..",
    "..##=======##...",
    "..##=======##...",
    "..##==###==##...",
    "..##==###==##...",
    "..##=======##...",
    "...##=====##....",
    "....##===##.....",
    ".....##=##......",
    "......###.......",
    ".......#........",
    "................",
    "................",
  ],
  spear: [
    "........#.......",
    ".......##.......",
    "......##=.......",
    ".....##=........",
    "....##=.........",
    "...##=..........",
    "..##............",
    ".##.............",
    "##..............",
    "#...............",
    "#...............",
    "##..............",
    ".##.............",
    "..#.............",
    "................",
    "................",
  ],
};

export function toPixelGrid(rows: string[]): number[][] {
  return rows.map((row) =>
    row.split("").map((ch) => {
      if (ch === "#") return 1;
      if (ch === "=") return 2;
      return 0;
    })
  );
}

export function weaponSvg(
  weaponType: WeaponType,
  size: number = 64,
  primaryColor: string = "#4fc3f7",
  accentColor: string = "#81d4fa"
): string {
  const grid = toPixelGrid(WEAPON_PIXEL_GRIDS[weaponType]);
  const rows = grid.length;
  const cols = grid[0]?.length ?? 16;
  const pixelW = size / cols;
  const pixelH = size / rows;

  const rects: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = grid[r][c];
      if (val === 0) continue;
      const color = val === 1 ? primaryColor : accentColor;
      const x = (c * pixelW).toFixed(2);
      const y = (r * pixelH).toFixed(2);
      const w = pixelW.toFixed(2);
      const h = pixelH.toFixed(2);
      rects.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"/>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">${rects.join("")}</svg>`;
}

export interface BuiltinSkillDef {
  id: string;
  name: string;
  weaponType: WeaponType;
  description: string;
  actionLabel: string;
  themeColors: { primary: string; secondary: string; accent: string };
}

export const BUILTIN_SKILLS: BuiltinSkillDef[] = [
  {
    id: "structure-check",
    name: "结构检查",
    weaponType: "blade",
    description: "检查论文结构完整性",
    actionLabel: "开始检查",
    themeColors: { primary: "#4fc3f7", secondary: "#0288d1", accent: "#b3e5fc" },
  },
  {
    id: "citation-scan",
    name: "引用扫描",
    weaponType: "bow",
    description: "扫描引用格式与完整性",
    actionLabel: "扫描引用",
    themeColors: { primary: "#ffb74d", secondary: "#f57c00", accent: "#ffe0b2" },
  },
  {
    id: "format-polish",
    name: "格式润色",
    weaponType: "hammer",
    description: "自动修正格式问题",
    actionLabel: "开始润色",
    themeColors: { primary: "#81c784", secondary: "#388e3c", accent: "#c8e6c9" },
  },
  {
    id: "grammar-guard",
    name: "语法守卫",
    weaponType: "shield",
    description: "检查语法与拼写错误",
    actionLabel: "检查语法",
    themeColors: { primary: "#ce93d8", secondary: "#7b1fa2", accent: "#e1bee7" },
  },
  {
    id: "compile-lance",
    name: "编译之矛",
    weaponType: "spear",
    description: "一键编译并诊断错误",
    actionLabel: "编译项目",
    themeColors: { primary: "#ef5350", secondary: "#c62828", accent: "#ffcdd2" },
  },
];
