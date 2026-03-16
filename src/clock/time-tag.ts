/**
 * Clock Time Tag Module
 * 生成时间标签，用于注入到 heartbeat 提示词
 */

export interface TimeTag {
  utc: string;
  local: string;
  tz: string;
  nowMs: number;
  ntpOffsetMs?: number;
}

/**
 * 格式化本地时间
 */
function formatLocal(date: Date, tz: string): string {
  try {
    const options: Intl.DateTimeFormatOptions = {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      fractionalSecondDigits: 3
    };
    return new Intl.DateTimeFormat('sv-SE', options).format(date);
  } catch {
    return date.toISOString();
  }
}

/**
 * 获取时区偏移描述
 */
function getTimezoneOffset(tz: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset'
    });
    const parts = formatter.formatToParts(now);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    return tzPart?.value || '';
  } catch {
    return '';
  }
}

/**
 * 构建时间标签
 * 唯一真源：所有时间标签生成都通过此函数
 */
export function buildTimeTag(): TimeTag {
  const now = new Date();
  const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  
  return {
    utc: now.toISOString(),
    local: formatLocal(now, tz),
    tz,
    nowMs: now.getTime(),
    ntpOffsetMs: 0 // TODO: NTP offset if available
  };
}

/**
 * 格式化时间标签为字符串
 */
export function formatTimeTag(tag?: TimeTag): string {
  const t = tag || buildTimeTag();
  const offset = getTimezoneOffset(t.tz);
  const offsetStr = offset ? ` ${offset}` : '';
  
  return `[Time/Date]: utc=\`${t.utc}\` local=\`${t.local}${offsetStr}\` tz=\`${t.tz}\` nowMs=\`${t.nowMs}\``;
}

/**
 * 构建简短时间行（用于注入到消息开头）
 */
export function buildTimeTagLine(): string {
  const tag = buildTimeTag();
  return formatTimeTag(tag);
}
