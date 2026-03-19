/**
 * Alarm Types
 * 闹钟数据模型
 */

export interface Alarm {
  /** 闹钟 ID，用户指定友好名称（如 daily-standup） */
  id: string;
  /** cron 表达式（5 字段：分 时 日 月 星期） */
  cron: string;
  /** 是否单次触发，触发后自动删除 */
  once: boolean;
  /** 项目名称（与 tmux session 名一致） */
  project: string;
  /** 可选附加消息（追加到 CLOCK.md 内容之后） */
  message?: string;
  /** 创建时间（ms） */
  createdAtMs: number;
  /** 最后触发时间（ms） */
  lastTriggeredAtMs?: number;
  /** 触发次数 */
  triggerCount: number;
  /** 是否启用 */
  enabled: boolean;
}

export interface AlarmCheckResult {
  /** tmux session 是否存活 */
  alive: boolean;
  /** 项目是否在 config.json 中注册 */
  registered: boolean;
  /** drudge session 文件是否存在（确保由 drudge 启动） */
  sessionFileExists?: boolean;
  /** 项目路径 */
  projectPath?: string;
  /** CLOCK.md 是否存在 */
  clockFileExists?: boolean;
  /** 是否可用于闹钟 */
  ready: boolean;
}
