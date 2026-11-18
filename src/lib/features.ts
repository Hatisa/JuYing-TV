/**
 * 功能开关。
 * 直播模块代码仍然保留（src/pages/LivePage.tsx 与相关 store/IPC），
 * 暂时隐藏入口；后续需要恢复时把 live 改为 true 即可。
 */
export const FEATURES = {
  live: false,
} as const;
