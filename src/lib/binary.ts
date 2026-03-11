function toUint8Array(view: ArrayBufferView) {
  return new Uint8Array(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

function hasBufferData(value: unknown): value is { data: unknown } {
  return typeof value === "object" && value !== null && "data" in value;
}

export function normalizeBinary(data?: unknown): Uint8Array | undefined {
  if (data == null) {
    return undefined;
  }

  if (data instanceof Uint8Array) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  if (ArrayBuffer.isView(data)) {
    return toUint8Array(data);
  }

  if (Array.isArray(data)) {
    return Uint8Array.from(data);
  }

  if (hasBufferData(data)) {
    return normalizeBinary(data.data);
  }

  if (typeof data === "object" && "length" in data && typeof data.length === "number") {
    return Uint8Array.from(data as ArrayLike<number>);
  }

  return undefined;
}
