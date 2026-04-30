# AE-Waiting-Time-Map 排序邏輯深度分析報告

## 1. `cmpSortVals` 的 order 邏輯分析

### 代碼（index.html:438-446）
```javascript
function cmpSortVals(a, b) {
    const tierIdx = { t1: 0, t2: 1, t3: 2, t45: 3 }[sortKey];
    const order = [tierIdx, 0, 1, 2, 3].filter((v, i, arr) => arr.indexOf(v) === i);
    const dir = sortDir === 'asc' ? 1 : -1;
    for (const i of order) {
      if (a[i] !== b[i]) return (a[i] - b[i]) * dir;
    }
    return 0;
}
```

### 當 sortKey="t45" 時的 order 計算
- `tierIdx = 3` (因為 sortKey='t45')
- `order = [3, 0, 1, 2, 3].filter((v, i, arr) => arr.indexOf(v) === i)`
- Filter 邏輯：`arr.indexOf(v) === i` 意味著保留第一次出現的位置
- `[3, 0, 1, 2, 3]` → 第一個 3 在 index 0，第一個 0 在 index 1，第一個 1 在 index 2，第一個 2 在 index 3，第二個 3 被過濾
- **結果：`order = [3, 0, 1, 2]`**

### 含義
比較順序：t45 → t1 → t2 → t3（作為 tiebreaker）

### 問題診斷

**核心問題：當用戶選擇「T4/5 非緊急」排序時，fallback 到 T1/T2/T3 是語義錯誤的。**

| 場景 | 問題 |
|------|------|
| 醫院A：T4/5=90分, T1=0分 | T4/5 等待很長 |
| 醫院B：T4/5=90分, T1=999分 | T1 等待很長 |
| **排序結果** | 醫院A排在前（因T1=0 < T1=999） |
| **實際意義** | 對T4/5病人來說，兩間醫院同樣差，但系統錯誤地推薦了醫院A |

**T4/5病人關心的是自己在T4/5的等待時間，不應因為T1快速而獲得「獎勵」。**

---

## 2. T2 "less than" 解析問題

### 代碼（index.html:429-431）
```javascript
const t2 = t2raw.toLowerCase().includes('less than')
  ? parseInt(t2raw.match(/less than\s*(\d+)/i)?.[1] || '99999')
  : (parseMins(t2raw) ?? 99999);
```

### 問題：United Christian Hospital 的 T2 值為 "Managing multiple resuscitation cases"

**解析過程：**
1. `"Managing multiple resuscitation cases".toLowerCase().includes('less than')` → `false`
2. 走 `parseMins(t2raw) ?? 99999`
3. `parseMins("Managing multiple resuscitation cases")` → 不匹配任何 pattern → 返回 `null`
4. `null ?? 99999` → `t2 = 99999`

### 問題所在
| 醫院 | t2wt 原始值 | t2 解析值 | 問題 |
|------|------------|----------|------|
| United Christian | "Managing multiple resuscitation cases" | 99999 | 變成了「最長等待」 |
| 其他17間 | "less than 15 minutes" | 15 | 正常 |

**爭議觀點：**
- **可能正確**：將無法確定時間的醫院排在最後（保守策略）
- **可能錯誤**：這不代表真的等待99999分鐘，只是「不確定」

---

## 3. `parseMins` 函數分析

### 代碼（index.html:403-423）
```javascript
function parseMins(str) {
    if (!str || str === 'N/A' || str === null) return null;
    str = String(str);
    if (str.toLowerCase().includes('less than')) {
      const m = str.match(/less than\s*(\d+)/i);
      return m ? parseInt(m[1]) : null;
    }
    const hourMatch = str.match(/(\d+(?:\.\d+)?)\s*hour/i);
    if (hourMatch) {
      const hours = parseFloat(hourMatch[1]);
      const minMatch = str.match(/(\d+)\s*minute/i);
      return Math.round(hours * 60 + (minMatch ? parseInt(minMatch[1]) : 0));
    }
    const minMatch = str.match(/(\d+)\s*minute/i);
    if (minMatch) return parseInt(minMatch[1]);
    const cnHour = str.match(/(\d+(?:\.\d+)?)\s*小時/);
    if (cnHour) return Math.round(parseFloat(cnHour[1]) * 60);
    const cnMin = str.match(/(\d+)\s*分鐘/);
    if (cnMin) return parseInt(cnMin[1]);
    return null;
}
```

### 測試案例
| 輸入 | 匹配 | 結果 | 狀態 |
|------|------|------|------|
| `"0 minute"` | `(\d+)\s*minute/i` | 0 | ✅ |
| `"less than 15 minutes"` | 第一個 if | 15 | ✅ |
| `"2 hours 30 minutes"` | hourMatch + minMatch | 150 | ✅ |
| `"1.5 小時"` | cnHour | 90 | ✅ |
| `"30 分鐘"` | cnMin | 30 | ✅ |
| `"Managing multiple resuscitation cases"` | 無匹配 | null | ✅ |
| `"N/A"` | 早期返回 | null | ✅ |

---

## 4. Edge Cases 列表

### 4.1 排序邏輯 Edge Cases

| # | 場景 | 預期行為 | 實際行為 | 嚴重性 |
|---|------|----------|----------|--------|
| 1 | 所有醫院 T4/5 相等時 | 維持相對順序或不排序 | fallback 到 T1→T2→T3 | 中 |
| 2 | sortKey='t1', T1都為0 | 看 T2 | 正常 | 低 |
| 3 | sortKey='t45', T45都為99999 | 全部相等 | 看 T1 | 中 |
| 4 | sortKey='t3', T3都為null | fallback 到 T1→T2→T45 | 正常 | 低 |

### 4.2 解析 Edge Cases

| # | 場景 | t1/t2/t3/t45 值 | 解析結果 | 問題 |
|---|------|----------------|----------|------|
| 1 | "Managing multiple resuscitation cases" | t1wt, t2wt | 99999 | 過度惩罚 |
| 2 | "less than 5 minutes" | t2wt | 5 | ✅ |
| 3 | "0 minute" | t1wt | 0 | ✅ |
| 4 | "N/A" | 任意 | null | ✅ |
| 5 | null/undefined | 任意 | null → 99999 | 邊界 |
| 6 | "2.5 hours" | t3p50 | 150 | ✅ |
| 7 | 混合中英文 "2小時30分鐘" | 任意 | 150 | ✅ |

### 4.3 特殊資料狀況

| 醫院 | t1wt | t2wt | t3p50 | t45p50 |
|------|------|------|-------|--------|
| United Christian Hospital | "Managing multiple resuscitation cases" | "Managing multiple resuscitation cases" | ? | ? |
| 其他17間 | "0 minute" | "less than 15 minutes" | varies | varies |

---

## 5. 修復方案

### 5.1 修復 cmpSortVals（行438-446）

**問題**：當 primary sort key 相等時，盲目 fallback 到其他 tier 的等待時間是語義錯誤的。

**建議**：fallback 應用同一 tier 的其他統計值，或完全不 fallback。

```javascript
// 方案A：移除 fallback 邏輯，純粹按選擇的 tier 排序
function cmpSortVals(a, b) {
    const tierIdx = { t1: 0, t2: 1, t3: 2, t45: 3 }[sortKey];
    const dir = sortDir === 'asc' ? 1 : -1;
    if (a[tierIdx] !== b[tierIdx]) return (a[tierIdx] - b[tierIdx]) * dir;
    return 0;  // 完全相等時維持順序
}

// 方案B：同 tier 內的其他統計值作為 fallback
// t1 只有一個值，無 fallback
// t2 只有一個值，無 fallback  
// t3 只有 t3p50，無 fallback
// t45 只有 t45p50，無 fallback
```

### 5.2 修復 T2 解析（行429-431）

**問題**：當 t2wt 是 "Managing multiple resuscitation cases" 時被錯誤轉換為 99999。

**建議**：區分「無法確定」（未知）和「等待極長」（確定性最差）。

```javascript
// 方案A：賦予一個合理的大值但非最大
const t2 = t2raw.toLowerCase().includes('less than')
  ? parseInt(t2raw.match(/less than\s*(\d+)/i)?.[1] || '99999')
  : (parseMins(t2raw) ?? 88888);  // 88888 表示「不確定」而非「最長」

// 方案B：對特殊訊息進行識別
function parseSpecialWaitTime(str, tier) {
    if (!str) return null;
    const lower = str.toLowerCase();
    if (lower.includes('managing multiple resuscitation') || 
        lower.includes('正在處理') ||
        lower.includes('搶救中')) {
        return tier === 't1' ? 99999 : 88888;  // T1 用 99999，T2-T5 用 88888
    }
    // ... 正常解析邏輯
}
```

### 5.3 完整修復代碼

```javascript
// ========== 修復後的 getSortVal (行426-435) ==========
function getSortVal(h) {
    const t1 = parseMins(h.t1wt) ?? 99999;
    const t2raw = h.t2wt || '';
    let t2;
    if (t2raw.toLowerCase().includes('less than')) {
        t2 = parseInt(t2raw.match(/less than\s*(\d+)/i)?.[1] || '99999');
    } else if (t2raw.toLowerCase().includes('managing multiple resuscitation')) {
        t2 = 88888; // 特殊狀態，不確定等待時間
    } else {
        t2 = parseMins(t2raw) ?? 88888;
    }
    const t3 = parseMins(h.t3p50) ?? 99999;
    const t45 = parseMins(h.t45p50) ?? 99999;
    return [t1, t2, t3, t45];
}

// ========== 修復後的 cmpSortVals (行438-446) ==========
function cmpSortVals(a, b) {
    const tierIdx = { t1: 0, t2: 1, t3: 2, t45: 3 }[sortKey];
    const dir = sortDir === 'asc' ? 1 : -1;
    if (a[tierIdx] !== b[tierIdx]) return (a[tierIdx] - b[tierIdx]) * dir;
    return 0;  // 移除語義錯誤的 fallback
}
```

---

## 6. 向其他 Agents 的提問

### 問題 1：向 Agent 1（UI/前端）提問
當前 fallback 邏輯（t45相等時看t1, t1相等時看t2...）是否是有意設計？還是需要向用戶澄清為何 T4/5 排序會受到 T1-T3 影響？

### 問題 2：向 Agent 2（數據獲取）提問
"Managing multiple resuscitation cases" 這個狀態在 API 中除了出現在 t1wt/t2wt，是否也會出現在 t3p50 或 t45p50？如果會，需要如何處理？
