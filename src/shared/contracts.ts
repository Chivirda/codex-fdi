import type { SpacingResult } from './spacing';
/** Serializable, API-independent contract. Omitted fields are not reliably representable. */
export interface RGBA { r: number; g: number; b: number; a: number }
export interface InspectorNode {
  id: string;
  name: string;
  type: string;
  width?: number;
  height?: number;
  spacing?: SpacingResult;
  layout?: {
    direction: 'row' | 'column';
    alignItems?: 'flex-start' | 'center' | 'flex-end' | 'baseline';
    justifyContent?: 'flex-start' | 'center' | 'flex-end' | 'space-between';
    gap?: number;
    padding?: [number, number, number, number];
  };
  backgroundColor?: RGBA;
  color?: RGBA;
  border?: { width: number; color: RGBA };
  borderRadius?: number | [number, number, number, number];
  opacity?: number;
  typography?: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    lineHeight?: { unit: 'px' | '%'; value: number };
    letterSpacing?: { unit: 'px' | 'em'; value: number };
  };
  warnings: string[];
}
export type InspectorState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'multiple'; count: number }
  | { status: 'error'; message: string }
  | { status: 'ready'; node: InspectorNode; css: string };
export type PluginMessage = { type: 'inspector-state'; state: InspectorState };
export type UIMessage = { type: 'ready' } | { type: 'refresh' }
  | { type: 'resize'; width: number; height: number; finished: boolean };
