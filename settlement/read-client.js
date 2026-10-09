(() => {
  "use strict";
  let worker = null, version = null, load = null, generation = 0, nextId = 0, progress = () => {};
  const pending = new Map();

  function release(message = "snapshot_read_cancelled") {
    generation++;
    if (load) load.controller.abort();
    load = null;
    version = null;
    if (worker) worker.terminate();
    worker = null;
    for (const waiter of pending.values()) waiter.reject(new Error(message));
    pending.clear();
    progress(null);
  }

  function send(type, data = {}) {
    if (!worker) {
      if (typeof Worker !== "function") return Promise.reject(new Error("이 브라우저에서 분석 기능을 사용할 수 없습니다. 최신 Chrome 또는 Edge로 열어주세요."));
      worker = new Worker("/settlement/analytics-worker.js?v=all-trends-v1-20261010", { type: "module" });
      worker.onmessage = ({ data: message }) => {
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error));
        else waiter.resolve(message.result);
      };
      worker.onerror = () => release("분석 파일을 불러오지 못했습니다. Ctrl+F5로 새로고침해주세요.");
    }
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      try { worker.postMessage({ id, type, ...data }); }
      catch (error) { pending.delete(id); reject(error); }
    });
  }

  async function fetchRead(apiRoot, query, signal) {
    const response = await fetch(`${apiRoot}/cache/read?${query}`, { cache: "no-store", signal });
    if (response.status === 401) throw new Error("로그인이 만료되었습니다.");
    let value;
    try { value = await response.json(); } catch { throw new Error(`정산 자료를 불러오지 못했습니다 (HTTP ${response.status}). 잠시 후 다시 시도해주세요.`); }
    if (!response.ok || value?.ok === false) throw new Error(value?.error || `HTTP ${response.status}`);
    if (query.has("chunkNo")) {
      // Chunk plaintext is passed through by the server without parsing and
      // serializing every row a second time. All validation happens before use.
      const headerNumber = name => {
        const text = response.headers.get(name);
        return text === null || text === "" ? NaN : Number(text);
      };
      return {
        snapshotVersion: response.headers.get("x-settlement-snapshot-version"),
        chunkNo: headerNumber("x-settlement-chunk-no"),
        rowsCount: headerNumber("x-settlement-rows-count"),
        chunkCount: headerNumber("x-settlement-chunk-count"),
        rows: Array.isArray(value) ? value : value?.rows,
      };
    }
    return value;
  }

  async function ensureSnapshot(apiRoot, meta) {
    if (!meta || !meta.snapshotVersion || !Number.isInteger(meta.rowsCount) || meta.rowsCount < 0 ||
        !Number.isInteger(meta.chunkCount) || meta.chunkCount < 0 || meta.chunkSize !== 500 ||
        meta.chunkCount !== Math.ceil(meta.rowsCount / meta.chunkSize)) throw new Error("invalid_r2_snapshot_meta");
    if (version === meta.snapshotVersion && worker) return;
    if (load) {
      await load.promise;
      return ensureSnapshot(apiRoot, meta);
    }
    const controller = new AbortController(), currentGeneration = generation;
    const ticket = { controller, promise: null };
    ticket.promise = (async () => {
      let received = 0;
      progress({ received, total: meta.rowsCount });
      await send("begin", { meta });
      // Two small authenticated requests at a time; each Worker reads one source chunk.
      for (let start = 0; start < meta.chunkCount; start += 2) {
        const indices = Array.from({ length: Math.min(2, meta.chunkCount - start) }, (_, offset) => start + offset);
        const chunks = await Promise.all(indices.map(chunkNo => fetchRead(apiRoot,
          new URLSearchParams({ snapshotVersion: meta.snapshotVersion, chunkNo: String(chunkNo) }), controller.signal)));
        for (let offset = 0; offset < chunks.length; offset++) {
          const part = chunks[offset], chunkNo = indices[offset];
          const expected = Math.min(meta.chunkSize, meta.rowsCount - chunkNo * meta.chunkSize);
          if (part.snapshotVersion !== meta.snapshotVersion || part.chunkNo !== chunkNo ||
              !Array.isArray(part.rows) || part.rows.length !== expected ||
              part.rows.some(row => !row || typeof row !== "object" || Array.isArray(row)) ||
              part.rowsCount !== meta.rowsCount || part.chunkCount !== meta.chunkCount) throw new Error("r2_snapshot_count_mismatch");
          if (generation !== currentGeneration) throw new Error("snapshot_read_cancelled");
          await send("chunk", { snapshotVersion: meta.snapshotVersion, chunkNo, rows: part.rows });
          received += part.rows.length;
          progress({ received, total: meta.rowsCount });
        }
      }
      const final = await fetchRead(apiRoot, new URLSearchParams({ snapshotVersion: meta.snapshotVersion }), controller.signal);
      if (generation !== currentGeneration) throw new Error("snapshot_read_cancelled");
      if (received !== meta.rowsCount || final.snapshot?.snapshotVersion !== meta.snapshotVersion ||
          final.snapshot?.rowsCount !== meta.rowsCount || final.snapshot?.chunkCount !== meta.chunkCount) throw new Error("snapshot_changed_retry");
      await send("commit", { snapshotVersion: meta.snapshotVersion });
      version = meta.snapshotVersion;
    })();
    load = ticket;
    try { await ticket.promise; }
    catch (error) { if (generation === currentGeneration) release(); throw error; }
    finally { if (load === ticket) load = null; if (generation === currentGeneration) progress(null); }
  }

  async function query(apiRoot, path, descriptor) {
    const meta = descriptor.snapshot;
    await ensureSnapshot(apiRoot, meta);
    const url = new URL(path, "https://settlement.invalid");
    const parameters = Object.fromEntries(url.searchParams);
    const view = url.pathname === "/meta" ? "meta" : url.pathname === "/records" ? "records" : "analytics";
    return send("query", { view, parameters, snapshotVersion: meta.snapshotVersion });
  }

  window.SettlementRead = { query, clear: release, setProgressHandler: handler => { progress = handler; } };
})();
