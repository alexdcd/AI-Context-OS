import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useObservabilityStore } from "../../lib/observabilityStore";

export function HealthBadge() {
  const { healthScore, loadHealthScore } = useObservabilityStore();
  const { t } = useTranslation();

  useEffect(() => {
    loadHealthScore();
    const interval = setInterval(loadHealthScore, 60_000);
    return () => clearInterval(interval);
  }, [loadHealthScore]);

  if (!healthScore) return null;

  const color =
    healthScore.score > 70
      ? "var(--accent)"
      : healthScore.score > 40
        ? "#f59e0b"
        : "#ef4444";

  const tooltipLines = [
    `${t("observability.health.dimensions.coverage")}: ${healthScore.breakdown.coverage.toFixed(0)}%`,
    `${t("observability.health.dimensions.efficiency")}: ${healthScore.breakdown.efficiency.toFixed(0)}%`,
    `${t("observability.health.dimensions.freshness")}: ${healthScore.breakdown.freshness.toFixed(0)}%`,
    `${t("observability.health.dimensions.balance")}: ${healthScore.breakdown.balance.toFixed(0)}%`,
    `${t("observability.health.dimensions.cleanliness")}: ${healthScore.breakdown.cleanliness.toFixed(0)}%`,
    "",
    t(`observability.health.summary.${healthScore.status}`),
  ].join("\n");

  return (
    <div
      className="health-badge"
      title={tooltipLines}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        color,
        border: `1px solid ${color}33`,
        background: `${color}11`,
        cursor: "default",
      }}
    >
      <span style={{ fontSize: 9 }}>&#9679;</span>
      {healthScore.score}
    </div>
  );
}
