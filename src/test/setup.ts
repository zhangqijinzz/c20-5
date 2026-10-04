// 让 React 19 的 act() 在 vitest（jsdom）环境下可用，消除 “not configured to support act” 警告
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
