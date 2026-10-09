import { computeAnalytics, computeMeta, computeRecords } from "./analytics-engine.js?v=2";

let snapshot = null, staging = null;
self.onmessage = ({ data }) => {
  const { id, type } = data;
  try {
    let result;
    if (type === "begin") {
      snapshot = null;
      staging = { meta: data.meta, parts: new Array(data.meta.chunkCount) };
      result = true;
    } else if (type === "chunk") {
      if (!staging || data.snapshotVersion !== staging.meta.snapshotVersion || !Number.isInteger(data.chunkNo) ||
          data.chunkNo < 0 || data.chunkNo >= staging.parts.length || !Array.isArray(data.rows) || staging.parts[data.chunkNo]) {
        throw new Error("invalid_snapshot_chunk");
      }
      staging.parts[data.chunkNo] = data.rows;
      result = true;
    } else if (type === "commit") {
      if (!staging || data.snapshotVersion !== staging.meta.snapshotVersion) throw new Error("snapshot_changed_retry");
      for (let i = 0; i < staging.parts.length; i++) if (!staging.parts[i]) throw new Error("r2_snapshot_incomplete");
      const rows = staging.parts.flat();
      if (rows.length !== staging.meta.rowsCount) throw new Error("r2_snapshot_count_mismatch");
      snapshot = { ...staging.meta, rows };
      staging = null;
      result = true;
    } else if (type === "query") {
      if (!snapshot || snapshot.snapshotVersion !== data.snapshotVersion) throw new Error("snapshot_changed_retry");
      if (data.view === "meta") result = computeMeta(snapshot);
      else if (data.view === "records") result = computeRecords(snapshot, data.parameters);
      else result = computeAnalytics(snapshot, data.parameters);
    } else throw new Error("unknown_worker_message");
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
