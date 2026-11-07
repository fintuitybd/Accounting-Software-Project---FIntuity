// Fintuity Accounting Suite — interactive money-flow Sankey.
//
// A hand-routed, cubic-Bézier alluvial chart: revenue streams feed one Gross inflow bar, which then
// breaks into cost of sales, operating expenses, the three Treasury outflows (VAT / VDS / TDS) and
// net cash retained. Ribbon thickness is derived from BigInt poisha — no chart library, no
// floating-point money. Hover, focus or click any node to trace its ribbon; the tooltip and the
// legend read exact BDT plus a Lakh/Crore compact figure and the exact percentage.

import { useMemo, useRef, useState, useId, type KeyboardEvent, type MouseEvent } from 'react';

import { toBanglaDigits } from '../../core/money';
import type { MotionTier } from './VaultVisuals';

const VIEW_W = 1120;
const VIEW_H = 520;
const TOP = 108;
const USABLE = 344;
const BOTTOM = TOP + USABLE;

const LEFT_X = 212;
const NODE_W = 18;
const MID_X = 528;
const MID_W = 26;
const RIGHT_X = 848;

const CHANNEL_GAP = 18;
const SINK_GAP = 13;
const LABEL_GAP = 35;

const CHANNEL_TONES = ['#6366f1', '#8b5cf6', '#a855f7', '#14b8a6'];
const SINK_TONES = ['#312e81', '#8b5cf6', '#6366f1', '#a855f7', '#f472b6', '#64748b'];

export interface MoneyFlowSankeyChannel {
  id: string;
  label: string;
  amount_poisha: bigint;
  tone?: string;
  hint?: string;
}

export interface MoneyFlowSankeySink {
  id: string;
  label: string;
  amount_poisha: bigint;
  tone?: string;
  hint?: string;
}

export interface MoneyFlowSankeyProps {
  channels: ReadonlyArray<MoneyFlowSankeyChannel>;
  sinks: ReadonlyArray<MoneyFlowSankeySink>;
  inflowLabel?: string;
  inflowHint?: string;
  money: (poisha: bigint, options?: { sign?: boolean; symbol?: boolean }) => string;
  compactMoney?: (poisha: bigint) => string;
  motionTier?: MotionTier;
  locale?: 'en-BD' | 'bn-BD';
  interactionHint?: string;
  className?: string;
  emptyLabel?: string;
}

interface Band {
  y0: number;
  y1: number;
}

interface TooltipState {
  key: string;
  x: number;
  y: number;
}

const safeId = (raw: string): string => raw.replace(/[^a-zA-Z0-9_-]/g, '');

function sumPoisha(values: ReadonlyArray<bigint>): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

function sharePct(amount: bigint, total: bigint): string {
  if (total <= 0n) return '0.0';
  const tenths = (amount * 1000n) / total;
  return (Number(tenths) / 10).toFixed(1);
}

/** Split a group of node bands across a fixed pixel height, preserving exact ratios. */
function bandsFor(amounts: ReadonlyArray<bigint>, total: bigint, gap: number): Band[] {
  if (amounts.length === 0) return [];
  const group = Math.max(0, Math.round(USABLE - gap * Math.max(0, amounts.length - 1)));
  const result: Band[] = [];
  let run = 0n;
  amounts.forEach((amount, index) => {
    const from = total > 0n ? Number((run * BigInt(group)) / total) : 0;
    run += amount;
    const to = total > 0n ? Number((run * BigInt(group)) / total) : 0;
    result.push({ y0: TOP + index * gap + from, y1: TOP + index * gap + to });
  });
  return result;
}

function ribbon(x0: number, y0a: number, y0b: number, x1: number, y1a: number, y1b: number): string {
  const mid = (x0 + x1) / 2;
  return `M ${x0} ${y0a} C ${mid} ${y0a} ${mid} ${y1a} ${x1} ${y1a} L ${x1} ${y1b} C ${mid} ${y1b} ${mid} ${y0b} ${x0} ${y0b} Z`;
}

function wrapLabel(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);
  if (lines.length > 2) return [lines[0], `${lines.slice(1).join(' ').slice(0, maxChars - 1)}…`];
  return lines;
}

/**
 * Resolve label collisions on the right-hand rail. Bands can be a couple of pixels thin (TDS,
 * a small input rebate), so each label is distributed with a minimum gap and joined to its node
 * with a leader line instead of overlapping its neighbours.
 */
function layoutLabels(centers: ReadonlyArray<number>, top: number, bottom: number, gap: number): number[] {
  const positions = centers.slice();
  const order = centers.map((center, index) => ({ center, index })).sort((left, right) => left.center - right.center);
  let cursor = top;
  for (const item of order) {
    positions[item.index] = Math.max(positions[item.index], cursor);
    cursor = positions[item.index] + gap;
  }
  let limit = bottom;
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const item = order[index];
    positions[item.index] = Math.min(positions[item.index], limit);
    limit = positions[item.index] - gap;
  }
  return positions;
}

const SANKEY_CSS = `
.ql-sankey .ql-sankey-link,
.ql-sankey .ql-sankey-node-rect,
.ql-sankey .ql-sankey-label { will-change: opacity; }
.ql-sankey--full .ql-sankey-link,
.ql-sankey--full .ql-sankey-node-rect,
.ql-sankey--full .ql-sankey-label { transition: opacity 220ms cubic-bezier(0.16,1,0.3,1), stroke-width 180ms ease; }
.ql-sankey--lite .ql-sankey-link,
.ql-sankey--lite .ql-sankey-node-rect,
.ql-sankey--lite .ql-sankey-label { transition: opacity 120ms ease; }
.ql-sankey--off .ql-sankey-link,
.ql-sankey--off .ql-sankey-node-rect,
.ql-sankey--off .ql-sankey-label { transition: none; }
.ql-sankey--full .ql-sankey-links { animation: ql-sankey-sweep 1050ms cubic-bezier(0.22, 1, 0.36, 1) both; }
.ql-sankey--lite .ql-sankey-links { animation: ql-sankey-fade 280ms ease both; }
.ql-sankey--off .ql-sankey-links { animation: none; }
.ql-sankey--full .ql-sankey-node { animation: ql-sankey-fade 520ms ease both; }
.ql-sankey--lite .ql-sankey-node { animation: ql-sankey-fade 200ms ease both; }
.ql-sankey--off .ql-sankey-node { animation: none; }
.ql-sankey-node:focus-visible { outline: 2px solid #6366f1; outline-offset: 4px; border-radius: 8px; }
@keyframes ql-sankey-sweep {
  0% { opacity: 0; clip-path: inset(0 100% 0 0); }
  100% { opacity: 1; clip-path: inset(0 0 0 0); }
}
@keyframes ql-sankey-fade {
  0% { opacity: 0; }
  100% { opacity: 1; }
}
`;

export function MoneyFlowSankey({
  channels,
  sinks,
  inflowLabel = 'Gross inflow',
  inflowHint,
  money,
  compactMoney,
  motionTier = 'FULL',
  locale = 'en-BD',
  interactionHint = 'Hover, focus or click a node to trace its ribbon.',
  className,
  emptyLabel = 'No money flows available for this period.',
}: MoneyFlowSankeyProps) {
  const isBn = locale === 'bn-BD';
  const L = (en: string, bn: string): string => (isBn ? bn : en);
  const N = (value: number): string => (isBn ? toBanglaDigits(String(value)) : String(value));
  const uid = safeId(useId());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const active = hover ?? pinned;
  const tierClass = motionTier === 'OFF' ? 'off' : motionTier === 'LITE' ? 'lite' : 'full';
  const compact = compactMoney ?? ((poisha: bigint) => money(poisha));

  const inflowTotal = useMemo(() => sumPoisha(channels.map((channel) => channel.amount_poisha)), [channels]);
  const sinkTotal = useMemo(() => sumPoisha(sinks.map((sink) => sink.amount_poisha)), [sinks]);
  const normalizedSinks = useMemo<bigint[]>(() => {
    const safe = sinks.map((sink) => (sink.amount_poisha > 0n ? sink.amount_poisha : 0n));
    if (safe.length === 0) return [];
    if (inflowTotal <= 0n || sinkTotal <= 0n || sinkTotal === inflowTotal) return safe;
    const scaled: bigint[] = [];
    let used = 0n;
    safe.forEach((amount, index) => {
      if (index === safe.length - 1) {
        scaled.push(inflowTotal - used);
        return;
      }
      const part = (amount * inflowTotal) / sinkTotal;
      scaled.push(part);
      used += part;
    });
    return scaled;
  }, [sinks, sinkTotal, inflowTotal]);

  const channelBands = useMemo(
    () => bandsFor(channels.map((channel) => (channel.amount_poisha > 0n ? channel.amount_poisha : 0n)), inflowTotal, CHANNEL_GAP),
    [channels, inflowTotal],
  );
  const inflowBands = useMemo(
    () => bandsFor(channels.map((channel) => (channel.amount_poisha > 0n ? channel.amount_poisha : 0n)), inflowTotal, 0),
    [channels, inflowTotal],
  );
  const sinkNodeBands = useMemo(() => bandsFor(normalizedSinks, inflowTotal, SINK_GAP), [normalizedSinks, inflowTotal]);
  const sinkInflowBands = useMemo(() => bandsFor(normalizedSinks, inflowTotal, 0), [normalizedSinks, inflowTotal]);
  const sinkLabelY = useMemo(
    () => layoutLabels(sinkNodeBands.map((band) => (band.y0 + band.y1) / 2), TOP + 8, BOTTOM - 8, LABEL_GAP),
    [sinkNodeBands],
  );

  const stageOf = (key: string): 'channel' | 'sink' | 'inflow' =>
    key.startsWith('channel:') ? 'channel' : key.startsWith('sink:') ? 'sink' : 'inflow';

  const opacityForLink = (key: string, base: number): number => {
    if (!active) return base;
    if (active === 'inflow') return base;
    if (active === key) return Math.min(1, base + 0.3);
    return stageOf(active) === stageOf(key) ? 0.08 : 0.18;
  };

  const opacityForNode = (key: string): number => {
    if (!active) return 1;
    if (active === 'inflow') return 1;
    return active === key ? 1 : 0.42;
  };

  const detail = useMemo(() => {
    if (!active) return null;
    if (active === 'inflow') {
      return {
        key: active,
        label: inflowLabel,
        amount: inflowTotal,
        share: '100.0',
        hint: inflowHint ?? `${channels.length} streams · ${sinks.length} applications`,
        tone: '#6366f1',
        shareLabel: L('of gross inflow', 'মোট আগমনের'),
      };
    }
    const isChannel = active.startsWith('channel:');
    const id = active.slice(active.indexOf(':') + 1);
    if (isChannel) {
      const found = channels.find((channel) => channel.id === id);
      if (!found) return null;
      return {
        key: active,
        label: found.label,
        amount: found.amount_poisha,
        share: sharePct(found.amount_poisha, inflowTotal),
        hint: found.hint ?? '',
        tone: found.tone ?? CHANNEL_TONES[channels.indexOf(found) % CHANNEL_TONES.length],
        shareLabel: L('of gross inflow', 'মোট আগমনের'),
      };
    }
    const found = sinks.find((sink) => sink.id === id);
    if (!found) return null;
    return {
      key: active,
      label: found.label,
      amount: found.amount_poisha,
      share: sharePct(found.amount_poisha, sinkTotal),
      hint: found.hint ?? '',
      tone: found.tone ?? SINK_TONES[sinks.indexOf(found) % SINK_TONES.length],
      shareLabel: L('of applications', 'প্রয়োগের'),
    };
  }, [active, channels, sinks, inflowTotal, sinkTotal, inflowLabel, inflowHint]);

  const moveTooltip = (event: MouseEvent<SVGGElement>, key: string): void => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setTooltip({
      key,
      x: Math.max(10, Math.min(x + 16, rect.width - 240)),
      y: Math.max(10, Math.min(y + 18, rect.height - 130)),
    });
  };

  const bindNode = (key: string, label: string, amount: bigint) => ({
    onMouseEnter: () => setHover(key),
    onMouseMove: (event: MouseEvent<SVGGElement>) => moveTooltip(event, key),
    onMouseLeave: () => {
      setHover(null);
      setTooltip(null);
    },
    onFocus: () => {
      setHover(key);
      setAnnouncement(`${label} — ${money(amount)}`);
    },
    onBlur: () => setHover(null),
    onClick: () => {
      setPinned((current) => (current === key ? null : key));
      setTooltip((current) => (current?.key === key ? null : current));
    },
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        setPinned((current) => (current === key ? null : key));
      }
      if (event.key === 'Escape') {
        setPinned(null);
        setTooltip(null);
      }
    },
  });

  if (channels.length === 0 || sinks.length === 0 || inflowTotal <= 0n) {
    return (
      <div className={['ql-sankey', `ql-sankey--${tierClass}`, className].filter(Boolean).join(' ')}>
        <style>{SANKEY_CSS}</style>
        <div className="grid h-44 place-items-center rounded-2xl border border-dashed border-line bg-surface-2/50 px-4 text-center">
          <p className="ql-hint">{L(emptyLabel, 'এই সময়ের জন্য কোনো অর্থপ্রবাহ নেই।')}</p>
        </div>
      </div>
    );
  }

  const inflowMid = MID_X + MID_W / 2;

  return (
    <div
      ref={containerRef}
      className={['ql-sankey', `ql-sankey--${tierClass}`, 'relative', className].filter(Boolean).join(' ')}
    >
      <style>{SANKEY_CSS}</style>
      <div className="overflow-x-auto overflow-y-hidden rounded-2xl">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-auto w-full min-w-[860px]"
          role="img"
          aria-label={`Money flow Sankey. ${channels.length} revenue streams feed ${money(inflowTotal)} gross inflow, split across ${sinks.length} applications.`}
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>Money flow — revenue streams to gross inflow to cost, tax, retained cash</title>
          <desc>
            Cubic-Bézier ribbons sized in BigInt poisha. Tab to a node to read its label and amount;
            press Enter to pin the trace. The legend below repeats every value in exact BDT.
          </desc>
          <defs>
            {channels.map((channel, index) => {
              const tone = channel.tone ?? CHANNEL_TONES[index % CHANNEL_TONES.length];
              return (
                <g key={`ch-def-${channel.id}`}>
                  <linearGradient id={`${uid}-ch-node-${index}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={tone} />
                    <stop offset="100%" stopColor={tone} stopOpacity="0.62" />
                  </linearGradient>
                  <linearGradient id={`${uid}-ch-link-${index}`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={tone} stopOpacity="0.55" />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0.38" />
                  </linearGradient>
                </g>
              );
            })}
            {sinks.map((sink, index) => {
              const tone = sink.tone ?? SINK_TONES[index % SINK_TONES.length];
              return (
                <g key={`sn-def-${sink.id}`}>
                  <linearGradient id={`${uid}-sn-node-${index}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={tone} />
                    <stop offset="100%" stopColor={tone} stopOpacity="0.6" />
                  </linearGradient>
                  <linearGradient id={`${uid}-sn-link-${index}`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity="0.38" />
                    <stop offset="100%" stopColor={tone} stopOpacity="0.55" />
                  </linearGradient>
                </g>
              );
            })}
            <linearGradient id={`${uid}-inflow`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a855f7" />
              <stop offset="52%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#0a0a16" />
            </linearGradient>
            <linearGradient id={`${uid}-inflow-edge`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e9d5ff" />
              <stop offset="100%" stopColor="#a855f7" />
            </linearGradient>
          </defs>

          {/* Engineering grid + stage rails */}
          <g style={{ stroke: 'rgb(var(--ql-border))' }} strokeWidth="0.7" strokeDasharray="1 7" opacity="0.55">
            {[TOP + 40, TOP + 126, TOP + 212, TOP + 298].map((y) => (
              <line key={y} x1={40} y1={y} x2={VIEW_W - 40} y2={y} />
            ))}
          </g>
          <g strokeWidth="1" strokeDasharray="2 6" style={{ stroke: 'rgb(var(--ql-border))' }} opacity="0.8">
            <line x1={370} y1={TOP - 14} x2={370} y2={BOTTOM + 18} />
            <line x1={706} y1={TOP - 14} x2={706} y2={BOTTOM + 18} />
          </g>

          {/* Stage headers */}
          <g fontFamily="Inter, Hind Siliguri, Noto Sans Bengali, system-ui, sans-serif" fontSize="8.4" fontWeight="600" letterSpacing="1.6">
            <text x={24} y={30} className="fill-ink-400">
              {L('REVENUE STREAMS', 'আয়ের উৎস')}
            </text>
            <text x={346} y={30} className="fill-ink-400">
              {L('GROSS INFLOW', 'মোট আগমন')}
            </text>
            <text x={738} y={30} className="fill-ink-400">
              {L('APPLICATIONS', 'প্রয়োগ')}
            </text>
          </g>
          <text x={24} y={46} fontFamily="Inter, Hind Siliguri, Noto Sans Bengali, system-ui, sans-serif" fontSize="9.4" className="fill-ink-500">
            {L(`${N(channels.length)} revenue streams`, `${N(channels.length)} আয়ের উৎস`)}
          </text>
          <text x={346} y={46} fontFamily="Inter, Hind Siliguri, Noto Sans Bengali, system-ui, sans-serif" fontSize="9.4" className="fill-ink-500">
            {L(`${N(sinks.length)} proportional outflows`, `${N(sinks.length)} আনুপাতিক বহির্গমন`)}
          </text>
          <text
            x={VIEW_W - 24}
            y={30}
            textAnchor="end"
            fontFamily="ui-monospace, SFMono-Regular, monospace"
            fontSize="8.2"
            letterSpacing="0.6"
            className="fill-ink-400"
          >
            {L('BDT · POISHA-EXACT', 'বিডিটি · পয়সা-নির্ভুল')}
          </text>
          <text x={VIEW_W - 24} y={46} textAnchor="end" fontFamily="Inter, Hind Siliguri, Noto Sans Bengali, system-ui, sans-serif" fontSize="9.4" className="fill-ink-500">
            {L(`${compact(inflowTotal)} conserved`, `${compact(inflowTotal)} সংরক্ষিত`)}
          </text>

          {/* Channel -> inflow ribbons */}
          <g className="ql-sankey-links">
            {channels.map((channel, index) => {
              const band = channelBands[index];
              const target = inflowBands[index];
              if (!band || !target) return null;
              const key = `channel:${channel.id}`;
              return (
                <path
                  key={`ch-link-${channel.id}`}
                  className="ql-sankey-link"
                  d={ribbon(LEFT_X + NODE_W, band.y0, band.y1, MID_X, target.y0, target.y1)}
                  fill={`url(#${uid}-ch-link-${index})`}
                  opacity={opacityForLink(key, 0.68)}
                  pointerEvents="none"
                />
              );
            })}

            {/* Inflow -> application ribbons */}
            {sinks.map((sink, index) => {
              const target = sinkNodeBands[index];
              const source = sinkInflowBands[index];
              if (!target || !source) return null;
              const key = `sink:${sink.id}`;
              return (
                <path
                  key={`sn-link-${sink.id}`}
                  className="ql-sankey-link"
                  d={ribbon(MID_X + MID_W, source.y0, source.y1, RIGHT_X, target.y0, target.y1)}
                  fill={`url(#${uid}-sn-link-${index})`}
                  opacity={opacityForLink(key, 0.68)}
                  pointerEvents="none"
                />
              );
            })}
          </g>

          {/* Channel nodes + labels */}
          {channels.map((channel, index) => {
            const band = channelBands[index];
            if (!band) return null;
            const key = `channel:${channel.id}`;
            const lines = wrapLabel(channel.label, 21);
            const isActive = active === key;
            const bandHeight = Math.max(3, band.y1 - band.y0);
            const blockHeight = lines.length * 13 + 16;
            const labelStart = band.y0 + Math.max(13, (bandHeight - blockHeight) / 2 + 12);
            const amountY = labelStart + lines.length * 13 + 3;
            return (
              <g
                key={`ch-node-${channel.id}`}
                className="ql-sankey-node"
                tabIndex={0}
                role="button"
                aria-label={`${channel.label}: ${money(channel.amount_poisha)} — ${sharePct(channel.amount_poisha, inflowTotal)}% of gross inflow`}
                style={{ cursor: 'pointer', animationDelay: `${index * 70}ms` }}
                {...bindNode(key, channel.label, channel.amount_poisha)}
              >
                <rect
                  x={LEFT_X - 10}
                  y={band.y0 - 6}
                  width={NODE_W + 28}
                  height={Math.max(30, band.y1 - band.y0 + 12)}
                  fill="transparent"
                />
                <rect
                  className="ql-sankey-node-rect"
                  x={LEFT_X}
                  y={band.y0}
                  width={NODE_W}
                  height={bandHeight}
                  rx={5}
                  fill={`url(#${uid}-ch-node-${index})`}
                  stroke={isActive ? '#c4b5fd' : 'transparent'}
                  strokeWidth={1.5}
                  opacity={opacityForNode(key)}
                  style={{ filter: isActive ? 'drop-shadow(0 0 8px rgba(217,119,6,0.35))' : undefined }}
                />
                <rect x={LEFT_X + 3} y={band.y0 + 3} width={3} height={Math.max(0, bandHeight - 6)} rx={2} fill="#ffffff" fillOpacity="0.18" />
                {lines.map((line, lineIndex) => (
                  <text
                    key={lineIndex}
                    className="ql-sankey-label fill-ink-900"
                    x={LEFT_X - 16}
                    y={labelStart + lineIndex * 13}
                    textAnchor="end"
                    fontFamily="Inter, Hind Siliguri, Noto Sans Bengali, system-ui, sans-serif"
                    fontSize="11"
                    fontWeight="600"
                    letterSpacing="-0.01em"
                    opacity={opacityForNode(key)}
                  >
                    {line}
                  </text>
                ))}
                <text
                  className="ql-sankey-label fill-ink-500"
                  x={LEFT_X - 16}
                  y={amountY}
                  textAnchor="end"
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  fontSize="9.2"
                  letterSpacing="0.02em"
                  opacity={opacityForNode(key)}
                >
                  {compact(channel.amount_poisha)}
                </text>
              </g>
            );
          })}

          {/* Gross inflow node */}
          <g
            className="ql-sankey-node"
            tabIndex={0}
            role="button"
            aria-label={`${inflowLabel}: ${money(inflowTotal)}`}
            style={{ cursor: 'pointer' }}
            {...bindNode('inflow', inflowLabel, inflowTotal)}
          >
            <rect x={MID_X - 12} y={TOP - 10} width={MID_W + 24} height={USABLE + 20} fill="transparent" />
            <rect
              x={MID_X}
              y={TOP}
              width={MID_W}
              height={USABLE}
              rx={7}
              fill={`url(#${uid}-inflow)`}
              stroke={`url(#${uid}-inflow-edge)`}
              strokeWidth={active === 'inflow' ? 2.6 : 1.2}
              strokeOpacity={active === 'inflow' ? 1 : 0.55}
              style={{ filter: active === 'inflow' ? 'drop-shadow(0 0 12px rgba(217,119,6,0.35))' : undefined }}
            />
            <rect x={MID_X + 4} y={TOP + 8} width={3} height={USABLE - 16} rx={2} fill="#c4b5fd" fillOpacity="0.34" />
            <text
              x={inflowMid}
              y={TOP - 40}
              textAnchor="middle"
              fontFamily="Inter, Hind Siliguri, Noto Sans Bengali, system-ui, sans-serif"
              fontSize="9"
              fontWeight="600"
              letterSpacing="1.8"
              className="fill-ink-500"
            >
              {inflowLabel.toUpperCase()}
            </text>
            <text
              x={inflowMid}
              y={TOP - 20}
              textAnchor="middle"
              fontFamily="Inter, Hind Siliguri, Noto Sans Bengali, system-ui, sans-serif"
              fontSize="20"
              fontWeight="600"
              letterSpacing="-0.035em"
              className="fill-ink-900"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {money(inflowTotal)}
            </text>
            <text
              x={inflowMid}
              y={BOTTOM + 24}
              textAnchor="middle"
              fontFamily="Inter, Hind Siliguri, Noto Sans Bengali, system-ui, sans-serif"
              fontSize="8.2"
              letterSpacing="1.2"
              className="fill-ink-400"
            >
              {L(`${N(channels.length)} IN → ${N(sinks.length)} OUT`, `${N(channels.length)} আগমন → ${N(sinks.length)} প্রয়োগ`)}
            </text>
            <text
              x={inflowMid}
              y={BOTTOM + 38}
              textAnchor="middle"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              fontSize="8"
              className="fill-ink-400"
            >
              {compact(inflowTotal)}
            </text>
          </g>

          {/* Application nodes + distributed labels with leader lines */}
          {sinks.map((sink, index) => {
            const band = sinkNodeBands[index];
            if (!band) return null;
            const key = `sink:${sink.id}`;
            const lines = wrapLabel(sink.label, 24);
            const isActive = active === key;
            const bandHeight = Math.max(3, band.y1 - band.y0);
            const nodeCenter = (band.y0 + band.y1) / 2;
            const labelCenter = sinkLabelY[index] ?? nodeCenter;
            const labelX = RIGHT_X + NODE_W + 24;
            return (
              <g
                key={`sn-node-${sink.id}`}
                className="ql-sankey-node"
                tabIndex={0}
                role="button"
                aria-label={`${sink.label}: ${money(sink.amount_poisha)} — ${sharePct(sink.amount_poisha, sinkTotal)}% of applications`}
                style={{ cursor: 'pointer', animationDelay: `${120 + index * 70}ms` }}
                {...bindNode(key, sink.label, sink.amount_poisha)}
              >
                <rect
                  x={RIGHT_X - 10}
                  y={band.y0 - 6}
                  width={NODE_W + 24}
                  height={Math.max(30, band.y1 - band.y0 + 12)}
                  fill="transparent"
                />
                <path
                  d={`M ${RIGHT_X + NODE_W} ${nodeCenter} L ${RIGHT_X + NODE_W + 10} ${nodeCenter} L ${labelX - 8} ${labelCenter}`}
                  fill="none"
                  stroke={sink.tone ?? SINK_TONES[index % SINK_TONES.length]}
                  strokeOpacity={isActive ? 0.75 : 0.28}
                  strokeWidth="0.9"
                  pointerEvents="none"
                  style={{ transition: 'stroke-opacity 180ms ease' }}
                />
                <rect
                  className="ql-sankey-node-rect"
                  x={RIGHT_X}
                  y={band.y0}
                  width={NODE_W}
                  height={bandHeight}
                  rx={5}
                  fill={`url(#${uid}-sn-node-${index})`}
                  stroke={isActive ? '#c4b5fd' : 'transparent'}
                  strokeWidth={1.5}
                  opacity={opacityForNode(key)}
                  style={{ filter: isActive ? 'drop-shadow(0 0 8px rgba(217,119,6,0.32))' : undefined }}
                />
                <rect x={RIGHT_X + 3} y={band.y0 + 3} width={3} height={Math.max(0, bandHeight - 6)} rx={2} fill="#ffffff" fillOpacity="0.16" />
                {lines.map((line, lineIndex) => (
                  <text
                    key={lineIndex}
                    className="ql-sankey-label fill-ink-900"
                    x={labelX}
                    y={labelCenter - (lines.length > 1 ? 5 : 1) + lineIndex * 13}
                    fontFamily="Inter, Hind Siliguri, Noto Sans Bengali, system-ui, sans-serif"
                    fontSize="10.8"
                    fontWeight="600"
                    letterSpacing="-0.005em"
                    opacity={opacityForNode(key)}
                  >
                    {line}
                  </text>
                ))}
                <text
                  className="ql-sankey-label fill-ink-500"
                  x={labelX}
                  y={labelCenter + (lines.length > 1 ? 16 : 13)}
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  fontSize="9"
                  opacity={opacityForNode(key)}
                >
                  {compact(sink.amount_poisha)}
                  <tspan className="fill-ink-400" dx="6" fontSize="8.2">
                    {sharePct(sink.amount_poisha, sinkTotal)}%
                  </tspan>
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Hover tooltip */}
      {detail && tooltip ? (
        <div
          className="ql-tooltip absolute z-20 w-[228px]"
          style={{ left: tooltip.x, top: tooltip.y }}
          role="status"
        >
          <div className="flex items-start gap-2">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: detail.tone }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-ink-900">{detail.label}</p>
              {detail.hint ? <p className="mt-0.5 text-[9px] leading-snug text-ink-500">{detail.hint}</p> : null}
            </div>
            <span className="font-mono text-[9px] text-ink-400">{detail.share}%</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-line/70 pt-1.5">
            <span className="font-money text-[12px] font-semibold text-ink-900">{money(detail.amount)}</span>
            <span className="font-mono text-[9px] text-ink-500">{compact(detail.amount)}</span>
          </div>
          <p className="mt-0.5 text-[8.5px] text-ink-400">
            {detail.share}% {detail.shareLabel} · {L('click to pin', 'পিন করতে ক্লিক করুন')}
          </p>
        </div>
      ) : null}

      {/* Detail rail */}
      <div className="mt-1 flex min-h-[42px] flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-line/70 bg-surface-2/60 px-3 py-2">
        {detail ? (
          <>
            <span className="flex min-w-0 items-center gap-2 text-[11.5px] font-semibold text-ink-800">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: detail.tone }} />
              <span className="truncate">{detail.label}</span>
              {detail.hint ? (
                <span className="hidden truncate text-[10px] font-normal text-ink-500 sm:inline">{detail.hint}</span>
              ) : null}
              <span className="ql-badge ql-badge-neutral hidden !py-0.5 sm:inline-flex">
                {detail.share}% {detail.shareLabel}
              </span>
            </span>
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="font-money text-[12px] font-semibold text-ink-900">{money(detail.amount)}</span>
              <span className="font-mono text-[10px] text-ink-500">{compact(detail.amount)}</span>
            </span>
          </>
        ) : (
          <p className="ql-hint">{interactionHint}</p>
        )}
      </div>

      {/* Always-legible application legend */}
      <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {sinks.map((sink, index) => {
          const key = `sink:${sink.id}`;
          const isActive = active === key;
          const tone = sink.tone ?? SINK_TONES[index % SINK_TONES.length];
          return (
            <button
              key={`legend-${sink.id}`}
              type="button"
              onClick={() => setPinned((current) => (current === key ? null : key))}
              onMouseEnter={() => setHover(key)}
              onMouseLeave={() => setHover(null)}
              className={`group flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition ${
                isActive
                  ? 'border-line-strong bg-surface shadow-sm'
                  : 'border-transparent hover:border-line hover:bg-surface/70'
              }`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone }} />
              <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-ink-600">{sink.label}</span>
              <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-ink-500">
                {compact(sink.amount_poisha)}
              </span>
              <span className="w-9 shrink-0 text-right font-mono text-[8.5px] tabular-nums text-ink-400">
                {sharePct(sink.amount_poisha, sinkTotal)}%
              </span>
            </button>
          );
        })}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

export default MoneyFlowSankey;
