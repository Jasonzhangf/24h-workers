# Drudge 状态机图

## 主状态机

```
                    ┌─────────────┐
                    │   STOPPED   │ ◄─────────────┐
                    └──────┬──────┘               │
                           │                      │
                           │ drudge start        │ drudge stop
                           ▼                      │
                    ┌─────────────┐               │
                    │   STARTING  │               │
                    └──────┬──────┘               │
                           │                      │
                           │ daemon ready         │
                           ▼                      │
                    ┌─────────────┐               │
    ┌──────────────►│   RUNNING   │───────────────┘
    │               └──────┬──────┘               
    │                      │                     
    │                      │ tick cycle          
    │                      ▼                     
    │               ┌─────────────┐               
    │               │   TICKING   │               
    │               └──────┬──────┘               
    │                      │                     
    │                      │ process all enabled 
    │                      │ sessions            
    │                      ▼                     
    │               ┌─────────────┐               
    └───────────────┤  BACK LOOP  │               
                    └─────────────┘               
```

## Session 状态机

```
┌──────────────┐
│   CREATED    │ (首次启用)
└──────┬───────┘
       │ drudge on -s <name>
       ▼
┌──────────────┐     ┌──────────────┐
│   ENABLED    │◄────┤   DISABLED   │
└──────┬───────┘     └──────────────┘
       │
       │ trigger heartbeat
       ▼
┌──────────────┐
│  TRIGGERING  │
└──────┬──���────┘
       │
       │ tmux alive?
       ├─── YES ──► ┌──────────────┐
       │            │ INJECT TEXT  │
       │            └──────┬───────┘
       │                   │
       │                   │ inject success?
       │                   ▼
       │            ┌──────────────┐
       │            │   SUCCESS    │
       │            └──────┬───────┘
       │                   │
       │                   │ update triggerCount
       │                   ▼
       │            ┌──────────────┐
       └───────────►│  ENABLED     │
                    └──────────────┘
       
       │
       └─── NO ───► ┌──────────────┐
                    │   DISABLED   │
                    │ (auto-off)   │
                    └──────────────┘
```

## 触发流程（Trigger Flow）

```
┌──────────────────┐
│  shouldTrigger?  │
└─────────┬────────┘
          │
          │ enabled?
          ├─── NO ──► SKIP
          │
          │ YES
          │
          │ lastTriggeredAtMs?
          ├─── NULL ──► TRIGGER (首次)
          │
          │ EXISTS
          │
          │ elapsed >= tickMs?
          ├─── NO ──► SKIP
          │
          │ YES
          ▼
┌──────────────────┐
│   TRIGGERING     │
└─────────┬────────┘
          │
          │ isTmuxSessionAlive?
          ├─── NO ──► DISABLE (auto-off)
          │
          │ YES
          │
          │ readHeartbeatPrompt
          ├─── empty ──► SKIP
          │
          │ EXISTS
          ▼
┌──────────────────┐
│  BUILD INJECT    │
│    TEXT          │
└─────────┬────────┘
          │
          ▼
┌──────────────────┐
│  INJECT TO TMUX  │
└─────────┬────────┘
          │
          │ success?
          ├─── NO ──► UPDATE lastError
          │
          │ YES
          ▼
┌──────────────────┐
│ UPDATE SESSION   │
│ triggerCount++   │
│ lastTriggeredAt  │
└──────────────────┘
```

## 代理模式状态机（Proxy Mode）

```
┌──────────────┐
│  PROXY STOP  │
└──────┬───────┘
       │ start --with-proxy
       │ proxy.enabled = true
       ▼
┌──────────────┐
│  PROXY START │
└──────┬───────┘
       │
       │ listen on 3 ports
       ▼
┌──────────────┐
│  LISTENING   │ ◄─────┐
└──────┬───────┘       │
       │               │
       │ receive req   │
       ▼               │
┌──────────────┐       │
│  FORWARDING  │       │
└──────┬───────┘       │
       │               │
       │ get response  │
       ▼               │
┌──────────────┐       │
│ EXTRACT      │       │
│ finish_reason│       │
└──────┬───────┘       │
       │               │
       │ shouldTrigger?│
       ├─── NO ────────┤
       │               │
       │ YES           │
       ▼               │
┌──────────────┐       │
│ TRIGGER ALL  │       │
│ ENABLED      │       │
└──────────────┘       │
       │               │
       └───────────────┘
```

## 错误处理流程

```
┌──────────────────┐
│  ERROR OCCURRED  │
└─────────┬────────┘
          │
          │ error type?
          │
          ├─── tmux_session_not_found ──► DISABLE session
          │
          ├─── prompt_not_found ────────► SKIP (log error)
          │
          ├─── tmux_send_failed ────────► UPDATE lastError
          │
          └─── other ──────────────────► UPDATE lastError
```
