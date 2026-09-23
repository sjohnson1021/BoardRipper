import type { ReactNode } from 'react';
import type { AnnotationTable, BoardData } from '../parsers';
import { hasNonLatin } from '../parsers/annotation-tables';
import { NetChip, PartChip } from './DiagnosisNotes';

/**
 * The repair tables an XZZ "common problems" board draws as text, rendered as
 * a real HTML <table> rather than canvas text.
 *
 * DOM is the point: "Translate page" in Chrome/Edge/Safari walks text nodes,
 * and canvas glyphs have none. So foreign runs carry a `lang` the translator
 * can key on, and identifiers carry translate="no" — a translated "U3900" or
 * "PP_VDD_BOOST" no longer matches anything on the board.
 */
export function AnnotationTables({ board }: { board: BoardData }) {
  const a = board.annotations;
  if (!a || (a.tables.length === 0 && a.notes.length === 0)) return null;
  const partIndex = new Map(board.parts.map((p, i) => [p.name, i]));
  return (
    <div className="annotation-tables" data-testid="annotation-tables" style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
        Board annotations
      </div>
      {a.tables.map((t, i) => <TableView key={i} table={t} board={board} partIndex={partIndex} />)}
      {a.notes.length > 0 && (
        <details style={{ fontSize: 11, marginTop: 4 }}>
          <summary style={{ cursor: 'pointer', color: '#cde' }}>{a.notes.length} loose note{a.notes.length === 1 ? '' : 's'}</summary>
          <ul style={{ margin: '4px 0', paddingLeft: 16 }}>
            {a.notes.map((n, i) => <li key={i}><Line text={n.text} board={board} partIndex={partIndex} /></li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function TableView({ table, board, partIndex }: { table: AnnotationTable; board: BoardData; partIndex: PartIndex }) {
  const total = table.columnWeights.reduce((s, w) => s + w, 0) || 1;
  const cell = { border: '1px solid #333', padding: '3px 5px', verticalAlign: 'top' } as const;
  return (
    <table
      data-testid="annotation-table"
      style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 11, lineHeight: 1.4, marginBottom: 6 }}
    >
      {table.caption && (
        <caption lang={langOf(table.caption)} style={{ captionSide: 'top', textAlign: 'left', fontWeight: 600, padding: '2px 0' }}>
          {table.caption}
        </caption>
      )}
      <colgroup>
        {table.columnWeights.map((w, i) => <col key={i} style={{ width: `${(w / total * 100).toFixed(1)}%` }} />)}
      </colgroup>
      <thead>
        <tr>
          {table.header.map((h, i) => (
            <th key={i} lang={langOf(h)} style={{ ...cell, background: '#222', textAlign: 'left' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, r) => (
          <tr key={r}>
            {row.map((lines, c) => (
              <td key={c} style={cell}>
                {lines.map((l, k) => <div key={k}><Line text={l} board={board} partIndex={partIndex} /></div>)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type PartIndex = ReadonlyMap<string, number>;

// Designators (U6300, C1402_K) and net names (PP3V0_TRISTAR), plus the
// slash-joined rail pairs the tables write.
const TOKEN = /[A-Za-z0-9_./+-]+/g;

/**
 * One line of cell text, with every token that names a part or net on THIS
 * board turned into the same chip the OBD notes use. Only resolvable tokens
 * become chips, so "5分钟" stays prose and a designator from another revision
 * does not offer a jump to nowhere.
 */
function Line({ text, board, partIndex }: { text: string; board: BoardData; partIndex: PartIndex }) {
  const out: ReactNode[] = [];
  let last = 0, key = 0;
  for (const m of text.matchAll(TOKEN)) {
    const tok = m[0];
    if (tok.length < 2 || !/[A-Za-z]/.test(tok)) continue;
    const part = partIndex.get(tok);
    const isNet = part === undefined && board.nets.has(tok);
    if (part === undefined && !isNet) continue;
    if (m.index > last) out.push(<Prose key={key++} text={text.slice(last, m.index)} />);
    out.push(
      <span key={key++} translate="no">
        {isNet ? <NetChip netName={tok} /> : <PartChip partName={tok} partIdx={part} />}
      </span>,
    );
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(<Prose key={key++} text={text.slice(last)} />);
  return <>{out}</>;
}

function Prose({ text }: { text: string }) {
  return hasNonLatin(text)
    ? <span lang={langOf(text)}>{text}</span>
    : <span translate="no">{text}</span>;
}

/** Coarse script → BCP-47, so a translator knows the source. Han is reported
 *  as zh-CN: every file seen comes from Chinese repair tooling. */
function langOf(s: string): string | undefined {
  if (!hasNonLatin(s)) return undefined;
  if (/[぀-ヿ]/.test(s)) return 'ja';
  if (/[가-힯]/.test(s)) return 'ko';
  if (/[Ѐ-ӿ]/.test(s)) return 'ru';
  return 'zh-CN';
}
