import { BRAND, SparkLockup, Spectrum } from "../shared/brand/index.tsx";
import { useI18n } from "../i18n/react.ts";

export function SparkSplash({ error }: { error?: string }) {
  const { t } = useI18n();
  return (
    <div className="spark-splash" role={error ? "alert" : "status"}>
      <div className="spark-splash-inner">
        <SparkLockup />
        <Spectrum />
        <span className="spark-kicker">{BRAND.descriptor}</span>
        {error && (
          <p className="text-muted-foreground max-w-96 text-center text-xs leading-relaxed wrap-anywhere">
            {t("splash.error", { name: BRAND.name })} {error}
          </p>
        )}
      </div>
    </div>
  );
}
