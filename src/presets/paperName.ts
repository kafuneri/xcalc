export const PAPER_YEARS: string[] = Array.from(
  { length: 2027 - 2010 + 1 },
  (_, idx) => String(2027 - idx)
);

export const PAPER_REGIONS_PINNED: string[] = [
  '国考',
  '河北',
  '天津',
  '北京',
];

export const PAPER_REGIONS_ALPHA: string[] = [
  '安徽',
  '福建',
  '甘肃',
  '广东',
  '广西',
  '贵州',
  '海南',
  '河北',
  '河南',
  '黑龙江',
  '湖北',
  '湖南',
  '吉林',
  '江苏',
  '江西',
  '辽宁',
  '内蒙古',
  '宁夏',
  '青海',
  '山东',
  '山西',
  '陕西',
  '上海',
  '四川',
  '天津',
  '西藏',
  '新疆',
  '云南',
  '浙江',
  '重庆',
  '深圳',
  '广州',
];

export const PAPER_LEVELS: string[] = [
  '地市级',
  '行政执法卷',
  '副省级',
  '县级',
  '乡镇',
];

export const PAPER_TYPES: string[] = ['行测真题', '行测模拟题'];

export const ZHICE_REGIONS_PINNED: string[] = [
  '事业单位联考',
  '河北省直',
  '天津事业单位',
  '北京事业单位',
];

export const ZHICE_LEVELS: string[] = ['A类', 'B类', 'C类', 'D类', 'E类'];

export const ZHICE_TYPES: string[] = ['职测真题', '职测模拟题'];

export const PAPER_INDEXES: string[] = [
  '（一）',
  '（二）',
  '（三）',
  '（四）',
  '（五）',
];

export interface PaperNameParts {
  year: string;
  region: string;
  level: string;
  paperType: string;
  index: string;
}

const CITY_EXAM_REGIONS = new Set(['北京', '天津', '上海', '重庆', '深圳', '广州']);

export function formatPaperRegion(region: string, paperType = ''): string {
  const trimmed = region.trim();
  if (!trimmed) return '';
  if (
    trimmed === '国考' ||
    trimmed.includes('事业单位') ||
    trimmed.endsWith('省考') ||
    trimmed.endsWith('市考') ||
    trimmed.endsWith('省直') ||
    paperType.startsWith('职测')
  ) {
    return trimmed;
  }
  return CITY_EXAM_REGIONS.has(trimmed) ? `${trimmed}市考` : `${trimmed}省考`;
}

export function buildPresetPaperName(parts: PaperNameParts): string {
  const yearPart = parts.year ? `${parts.year}年` : '';
  const regionPart = formatPaperRegion(parts.region, parts.paperType);
  return [
    yearPart,
    regionPart,
    parts.level,
    parts.paperType,
    parts.index,
  ]
    .filter(Boolean)
    .join('');
}

export function getLocalDateString(ts = Date.now()): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
