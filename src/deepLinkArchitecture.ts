import { parse, stringify } from "yaml";
import { validateGraphReferences } from "./graphBuilder";
import { validateOverlayReferences } from "./overlays";
import type { ArchitectureSourcePayload, RuntimeArchitecturePayload } from "./runtime/types";
import {
  EMPTY_ARCHITECTURE_OVERLAYS,
  validateArchitectureManifest,
  type ArchitectureOverlays
} from "./zod";

export const ARCHITECTURE_HASH_PARAM = "architecture";

const EMPTY_OVERLAYS_YAML = stringify(EMPTY_ARCHITECTURE_OVERLAYS);

export interface DeepLinkArchitecture {
  payload: RuntimeArchitecturePayload;
  source: ArchitectureSourcePayload;
}

function bytesToBinary(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return binary;
}

function binaryToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function encodeBase64UrlUtf8(value: string): string {
  const base64 = btoa(bytesToBinary(new TextEncoder().encode(value)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

export function decodeBase64UrlUtf8(value: string): string {
  if (!value || !/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
    throw new Error("architecture deep link is not valid base64url");
  }

  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");

  try {
    return new TextDecoder().decode(binaryToBytes(atob(padded)));
  } catch {
    throw new Error("architecture deep link is not valid base64url");
  }
}

export function buildArchitectureDeepLink(architectureYaml: string, baseUrl = window.location.href): string {
  const url = new URL(baseUrl);
  url.hash = `${ARCHITECTURE_HASH_PARAM}=${encodeBase64UrlUtf8(architectureYaml)}`;
  return url.toString();
}

export function hasArchitectureDeepLink(hash = window.location.hash): boolean {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return params.has(ARCHITECTURE_HASH_PARAM);
}

export function readArchitectureDeepLinkSource(hash = window.location.hash): ArchitectureSourcePayload | undefined {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const encodedArchitecture = params.get(ARCHITECTURE_HASH_PARAM);

  if (encodedArchitecture === null) {
    return undefined;
  }

  return {
    architectureYaml: decodeBase64UrlUtf8(encodedArchitecture),
    overlaysYaml: EMPTY_OVERLAYS_YAML
  };
}

export function loadArchitectureDeepLink(hash = window.location.hash): DeepLinkArchitecture | undefined {
  const source = readArchitectureDeepLinkSource(hash);

  if (!source) {
    return undefined;
  }

  const manifest = validateArchitectureManifest(parse(source.architectureYaml));
  const overlays: ArchitectureOverlays = EMPTY_ARCHITECTURE_OVERLAYS;
  validateGraphReferences(manifest);
  validateOverlayReferences(manifest, overlays);

  return {
    source,
    payload: {
      manifest,
      overlays,
      architectureRevision: 1,
      overlayRevision: 1,
      overlayGeneratedAt: new Date(0).toISOString(),
      overlaySource: "deep-link",
      overlayStatus: { state: "dynamic" },
      editorEnabled: true,
      graphControlsVisible: false,
      graphControlApplyEnabled: false
    }
  };
}
