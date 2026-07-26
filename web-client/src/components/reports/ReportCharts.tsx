import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { Box, Stack, Tooltip, Typography, useTheme } from "@mui/material";
import type {
  BacklogAgeBucket,
  SlaComplianceRow,
  VolumeBucket,
} from "../../api/client";
import { chartColor, type ChartPaletteSlot } from "./chartPalette";

const SVG_WIDTH = 760;
const PLOT_LEFT = 54;
const PLOT_RIGHT = 670;

const compactNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const dayLabel = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function formatDay(day: string): string {
  return dayLabel.format(new Date(`${day}T00:00:00.000Z`));
}

function evenlySpacedIndexes(length: number, desired = 5): number[] {
  if (length <= desired) return Array.from({ length }, (_, index) => index);
  const indexes = new Set<number>([0, length - 1]);
  for (let index = 1; index < desired - 1; index += 1) {
    indexes.add(Math.round((index * (length - 1)) / (desired - 1)));
  }
  return [...indexes].sort((a, b) => a - b);
}

function ChartScroller({
  children,
  minWidth = 660,
}: {
  children: React.ReactNode;
  minWidth?: number;
}) {
  return (
    <Box sx={{ maxWidth: "100%", overflowX: "auto", overscrollBehaviorInline: "contain" }}>
      <Box sx={{ minWidth }}>{children}</Box>
    </Box>
  );
}

function Legend({
  items,
}: {
  items: { label: string; color: string; symbol?: string }[];
}) {
  return (
    <Stack
      direction="row"
      useFlexGap
      sx={{ flexWrap: "wrap", gap: 2, mb: 1 }}
      aria-label="Chart legend"
    >
      {items.map((item) => (
        <Stack key={item.label} direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
          <Box
            aria-hidden="true"
            sx={{
              width: 12,
              height: 12,
              borderRadius: item.symbol ? 0.5 : "50%",
              bgcolor: item.color,
              display: "grid",
              placeItems: "center",
              color: "common.white",
              fontSize: 10,
              lineHeight: 1,
              fontWeight: 800,
            }}
          >
            {item.symbol}
          </Box>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {item.label}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

/** Two same-scale event counts on one y-axis. Hovering exposes a crosshair and
 * tooltip; 8px markers remain visible without becoming the dominant mark. */
export function VolumeLineChart({ data }: { data: VolumeBucket[] }) {
  const theme = useTheme();
  const [active, setActive] = useState<number | null>(null);
  const plotTop = 20;
  const plotBottom = 210;
  const maxValue = Math.max(1, ...data.flatMap((row) => [row.created, row.resolved]));
  const x = (index: number) =>
    data.length <= 1
      ? (PLOT_LEFT + PLOT_RIGHT) / 2
      : PLOT_LEFT + (index / (data.length - 1)) * (PLOT_RIGHT - PLOT_LEFT);
  const y = (value: number) =>
    plotBottom - (value / maxValue) * (plotBottom - plotTop);
  const path = (key: "created" | "resolved") =>
    data.map((row, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(row[key])}`).join(" ");

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = ((event.clientX - rect.left) / rect.width) * SVG_WIDTH;
    const fraction = (localX - PLOT_LEFT) / (PLOT_RIGHT - PLOT_LEFT);
    setActive(Math.max(0, Math.min(data.length - 1, Math.round(fraction * (data.length - 1)))));
  };

  const tooltipX = active === null ? 0 : Math.min(PLOT_RIGHT - 116, Math.max(PLOT_LEFT + 8, x(active) + 10));
  const final = data[data.length - 1];
  const finalIndex = data.length - 1;
  const labelsOverlap = final && Math.abs(y(final.created) - y(final.resolved)) < 18;

  return (
    <>
      <Legend
        items={[
          { label: "Created", color: chartColor(1) },
          { label: "Resolved", color: chartColor(2) },
        ]}
      />
      <ChartScroller>
        <svg
          viewBox={`0 0 ${SVG_WIDTH} 260`}
          width="100%"
          height="260"
          role="img"
          aria-label="Daily tickets created and resolved, sharing one count axis"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(null)}
          style={{ display: "block", touchAction: "pan-x" }}
        >
          {[0, 0.5, 1].map((fraction) => {
            const gridY = plotBottom - fraction * (plotBottom - plotTop);
            return (
              <g key={fraction}>
                <line
                  x1={PLOT_LEFT}
                  x2={PLOT_RIGHT}
                  y1={gridY}
                  y2={gridY}
                  stroke={theme.palette.divider}
                  strokeWidth="1"
                />
                <text
                  x={PLOT_LEFT - 8}
                  y={gridY + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill={theme.palette.text.secondary}
                >
                  {compactNumber.format(maxValue * fraction)}
                </text>
              </g>
            );
          })}
          {evenlySpacedIndexes(data.length).map((index) => (
            <text
              key={data[index].day}
              x={x(index)}
              y={238}
              textAnchor="middle"
              fontSize="11"
              fill={theme.palette.text.secondary}
            >
              {formatDay(data[index].day)}
            </text>
          ))}
          <path d={path("created")} fill="none" stroke={chartColor(1)} strokeWidth="2" />
          <path d={path("resolved")} fill="none" stroke={chartColor(2)} strokeWidth="2" />
          {data.map((row, index) => (
            <g key={row.day}>
              <circle cx={x(index)} cy={y(row.created)} r="4" fill={chartColor(1)}>
                <title>{`${formatDay(row.day)} — Created: ${row.created}`}</title>
              </circle>
              <circle cx={x(index)} cy={y(row.resolved)} r="4" fill={chartColor(2)}>
                <title>{`${formatDay(row.day)} — Resolved: ${row.resolved}`}</title>
              </circle>
              <circle cx={x(index)} cy={y(row.created)} r="10" fill="transparent" />
              <circle cx={x(index)} cy={y(row.resolved)} r="10" fill="transparent" />
            </g>
          ))}
          {final && (
            <>
              <text
                x={x(finalIndex) + 9}
                y={y(final.created) + (labelsOverlap ? -7 : 4)}
                fontSize="11"
                fontWeight="600"
                fill={theme.palette.text.primary}
              >
                Created
              </text>
              <text
                x={x(finalIndex) + 9}
                y={y(final.resolved) + (labelsOverlap ? 14 : 4)}
                fontSize="11"
                fontWeight="600"
                fill={theme.palette.text.primary}
              >
                Resolved
              </text>
            </>
          )}
          {active !== null && (
            <g pointerEvents="none">
              <line
                x1={x(active)}
                x2={x(active)}
                y1={plotTop}
                y2={plotBottom}
                stroke={theme.palette.text.secondary}
                strokeWidth="1"
                strokeDasharray="4 4"
              />
              <rect
                x={tooltipX}
                y={28}
                width="126"
                height="62"
                rx="7"
                fill={theme.palette.background.paper}
                stroke={theme.palette.divider}
              />
              <text x={tooltipX + 9} y={46} fontSize="11" fill={theme.palette.text.secondary}>
                {formatDay(data[active].day)}
              </text>
              <text x={tooltipX + 9} y={64} fontSize="12" fill={theme.palette.text.primary}>
                {`Created ${data[active].created}`}
              </text>
              <text x={tooltipX + 9} y={81} fontSize="12" fill={theme.palette.text.primary}>
                {`Resolved ${data[active].resolved}`}
              </text>
            </g>
          )}
        </svg>
      </ChartScroller>
    </>
  );
}

export interface GroupedBarCategory {
  label: string;
  values: (number | null)[];
}

export interface GroupedBarSeries {
  label: string;
  slot: ChartPaletteSlot;
}

/** Thin grouped bars for same-unit comparisons. A transparent 40px-high mark
 * behind each bar makes its tooltip reachable without visually fattening it. */
export function GroupedBarChart({
  ariaLabel,
  categories,
  series,
  valueLabel = (value) => compactNumber.format(value),
  categoryOpacities,
  minWidth,
}: {
  ariaLabel: string;
  categories: GroupedBarCategory[];
  series: GroupedBarSeries[];
  valueLabel?: (value: number) => string;
  categoryOpacities?: number[];
  minWidth?: number;
}) {
  const theme = useTheme();
  const plotTop = 22;
  const plotBottom = 205;
  const maxValue = Math.max(
    1,
    ...categories.flatMap((category) => category.values.map((value) => value ?? 0))
  );
  const groupWidth = (PLOT_RIGHT - PLOT_LEFT) / Math.max(categories.length, 1);
  const barWidth = Math.min(64, (groupWidth - 24) / Math.max(series.length, 1));
  const y = (value: number) =>
    plotBottom - (value / maxValue) * (plotBottom - plotTop);

  return (
    <>
      {series.length >= 2 && (
        <Legend
          items={series.map((item) => ({
            label: item.label,
            color: chartColor(item.slot),
          }))}
        />
      )}
      <ChartScroller minWidth={minWidth}>
        <svg
          viewBox={`0 0 ${SVG_WIDTH} 255`}
          width="100%"
          height="255"
          role="img"
          aria-label={ariaLabel}
          style={{ display: "block" }}
        >
          {[0, 0.5, 1].map((fraction) => {
            const gridY = plotBottom - fraction * (plotBottom - plotTop);
            return (
              <g key={fraction}>
                <line
                  x1={PLOT_LEFT}
                  x2={PLOT_RIGHT}
                  y1={gridY}
                  y2={gridY}
                  stroke={theme.palette.divider}
                  strokeWidth="1"
                />
                <text
                  x={PLOT_LEFT - 8}
                  y={gridY + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill={theme.palette.text.secondary}
                >
                  {valueLabel(maxValue * fraction)}
                </text>
              </g>
            );
          })}
          {categories.map((category, categoryIndex) => {
            const center = PLOT_LEFT + groupWidth * (categoryIndex + 0.5);
            const totalBarsWidth = series.length * barWidth + (series.length - 1) * 2;
            return (
              <g key={category.label}>
                {series.map((item, seriesIndex) => {
                  const value = category.values[seriesIndex];
                  if (value === null) return null;
                  const barX = center - totalBarsWidth / 2 + seriesIndex * (barWidth + 2);
                  const barY = y(value);
                  const visibleHeight = Math.max(2, plotBottom - barY);
                  return (
                    <g key={item.label}>
                      <rect
                        x={barX}
                        y={barY}
                        width={barWidth}
                        height={visibleHeight}
                        rx="2"
                        fill={chartColor(item.slot)}
                        fillOpacity={categoryOpacities?.[categoryIndex] ?? 1}
                      />
                      <rect
                        x={barX - 4}
                        y={Math.max(plotTop, barY - 8)}
                        width={barWidth + 8}
                        height={Math.max(40, visibleHeight + 12)}
                        fill="transparent"
                      >
                        <title>{`${category.label} — ${item.label}: ${valueLabel(value)}`}</title>
                      </rect>
                      <text
                        x={barX + barWidth / 2}
                        y={Math.max(plotTop + 10, barY - 6)}
                        textAnchor="middle"
                        fontSize="11"
                        fontWeight="600"
                        fill={theme.palette.text.primary}
                      >
                        {valueLabel(value)}
                      </text>
                    </g>
                  );
                })}
                <text
                  x={center}
                  y={231}
                  textAnchor="middle"
                  fontSize="11"
                  fill={theme.palette.text.secondary}
                >
                  {category.label}
                </text>
              </g>
            );
          })}
        </svg>
      </ChartScroller>
    </>
  );
}

export function BacklogBarChart({ data }: { data: BacklogAgeBucket[] }) {
  return (
    <GroupedBarChart
      ariaLabel="Open tickets grouped into backlog age buckets"
      categories={data.map((row) => ({ label: row.bucket, values: [row.count] }))}
      series={[{ label: "Open tickets", slot: 1 }]}
      categoryOpacities={[0.28, 0.43, 0.58, 0.76, 1]}
    />
  );
}

export interface HorizontalBarDatum {
  id: string;
  label: string;
  value: number;
}

/** Single-series ranked bar form. Every row keeps the same fixed slot rather
 * than taking a color from its current rank. */
export function HorizontalBarChart({
  ariaLabel,
  data,
  slot = 1,
  valueLabel = (value) => compactNumber.format(value),
}: {
  ariaLabel: string;
  data: HorizontalBarDatum[];
  slot?: ChartPaletteSlot;
  valueLabel?: (value: number) => string;
}) {
  const theme = useTheme();
  const rowHeight = 38;
  const plotLeft = 180;
  const plotRight = 650;
  const height = Math.max(110, data.length * rowHeight + 30);
  const maxValue = Math.max(1, ...data.map((row) => row.value));
  return (
    <ChartScroller>
      <svg
        viewBox={`0 0 ${SVG_WIDTH} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={ariaLabel}
        style={{ display: "block" }}
      >
        {data.map((row, index) => {
          const y = 12 + index * rowHeight;
          const width = ((plotRight - plotLeft) * row.value) / maxValue;
          const displayLabel = row.label.length > 24 ? `${row.label.slice(0, 23)}…` : row.label;
          return (
            <g key={row.id}>
              <text
                x={plotLeft - 10}
                y={y + 18}
                textAnchor="end"
                fontSize="12"
                fill={theme.palette.text.primary}
              >
                {displayLabel}
                <title>{row.label}</title>
              </text>
              <rect
                x={plotLeft}
                y={y}
                width={Math.max(row.value === 0 ? 0 : 2, width)}
                height="22"
                rx="2"
                fill={chartColor(slot)}
              />
              <rect
                x={plotLeft - 5}
                y={y - 7}
                width={Math.max(40, width + 10)}
                height="36"
                fill="transparent"
              >
                <title>{`${row.label}: ${valueLabel(row.value)}`}</title>
              </rect>
              <text
                x={plotLeft + width + 8}
                y={y + 17}
                fontSize="12"
                fontWeight="600"
                fill={theme.palette.text.primary}
              >
                {valueLabel(row.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </ChartScroller>
  );
}

const SLA_STATES = [
  { key: "met", label: "Met", symbol: "✓" },
  { key: "onTrack", label: "On track", symbol: "●" },
  { key: "atRisk", label: "At risk", symbol: "▲" },
  { key: "breached", label: "Breached", symbol: "!" },
] as const;

export function SlaStatusChart({ data }: { data: SlaComplianceRow[] }) {
  const theme = useTheme();
  const colors = {
    met: theme.palette.success.main,
    onTrack: theme.palette.grey[500],
    atRisk: theme.palette.warning.main,
    breached: theme.palette.error.main,
  };

  return (
    <Box role="img" aria-label="Response and resolution SLA promises by compliance state">
      <Legend
        items={SLA_STATES.map((state) => ({
          label: state.label,
          color: colors[state.key],
          symbol: state.symbol,
        }))}
      />
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        {data.map((row) => {
          const total = SLA_STATES.reduce((sum, state) => sum + row[state.key], 0);
          return (
            <Box key={row.kind}>
              <Stack direction="row" sx={{ justifyContent: "space-between", mb: 0.75 }}>
                <Typography variant="body2" sx={{ color: "text.primary", textTransform: "capitalize", fontWeight: 600 }}>
                  {row.kind}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {total} promises
                </Typography>
              </Stack>
              <Stack
                direction="row"
                spacing="2px"
                sx={{
                  height: 22,
                  borderRadius: 1,
                  overflow: "visible",
                  bgcolor: "action.hover",
                }}
              >
                {SLA_STATES.map((state) => {
                  const value = row[state.key];
                  if (value === 0) return null;
                  return (
                    <Tooltip
                      key={state.key}
                      title={`${state.label}: ${value} of ${total}`}
                      arrow
                    >
                      <Box
                        component="span"
                        sx={{
                          position: "relative",
                          flexGrow: value,
                          flexBasis: 0,
                          minWidth: 2,
                          bgcolor: colors[state.key],
                          "&::after": {
                            content: '""',
                            position: "absolute",
                            inset: -7,
                          },
                        }}
                      />
                    </Tooltip>
                  );
                })}
              </Stack>
              <Stack
                direction="row"
                useFlexGap
                sx={{ flexWrap: "wrap", columnGap: 1.5, rowGap: 0.5, mt: 0.75 }}
              >
                {SLA_STATES.map((state) => (
                  <Stack key={state.key} direction="row" spacing={0.4} sx={{ alignItems: "baseline" }}>
                    <Typography
                      component="span"
                      variant="caption"
                      aria-hidden="true"
                      sx={{ color: colors[state.key], fontWeight: 900 }}
                    >
                      {state.symbol}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "text.secondary" }}>
                      {state.label}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "text.primary", fontWeight: 700 }}>
                      {row[state.key]}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
