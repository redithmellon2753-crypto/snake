// ============================================================
// network.js — Supabase 客户端
// ★ 优化：上传结构化字段（mode/diff），不再依赖字符串包含匹配
// ★ 优化：暴露 isNetworkAvailable
// ============================================================
import { SB_URL, SB_KEY, UPLOAD_INTERVAL } from './config.js';
import { load, save } from './storage.js';

let sb = null;
let online = true;
try {
  if (window.supabase) sb = window.supabase.createClient(SB_URL, SB_KEY);
} catch { /* CDN 未加载 */ }

window.addEventListener('online',  () => { online = true; });
window.addEventListener('offline', () => { online = false; });
export function isNetworkAvailable() { return online && !!sb; }

// ★ 优化：直接传 mode/diff 字段，前端展示时再拼
export async function uploadScore(name, score, mode, diff) {
  if (!sb || !online || score <= 0 || score > 999999) return false;
  const lastUpload = load('lu', 0);
  if (Date.now() - lastUpload < UPLOAD_INTERVAL) return false;
  save('lu', Date.now());
  try {
    const nm = String(name || '匿名').slice(0, 20);
    const { error } = await sb.from('scores').insert({
      name: nm,
      score: score | 0,
      mode: mode || 'classic',
      diff: diff || 'normal',
      // ★ 兼容字段：旧表若只有 mode，则写入 "经典 [普通]" 字符串
      mode_str: nm + '|' + score + '|' + (mode || 'classic')
    });
    return !error;
  } catch {
    return false;
  }
}

export async function fetchGlobal(timeRange) {
  if (!sb) return null;
  try {
    let q = sb.from('scores')
      .select('name,score,mode,diff,created_at')
      .order('score', { ascending: false })
      .limit(100);
    if (timeRange === 'day') {
      q = q.gte('created_at', new Date(Date.now() - 86400000).toISOString());
    } else if (timeRange === 'week') {
      q = q.gte('created_at', new Date(Date.now() - 604800000).toISOString());
    }
    const { data, error } = await q;
    if (error) return null;
    return data || [];
  } catch {
    return null;
  }
}
