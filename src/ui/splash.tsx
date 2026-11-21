import { BRAND, SparkLockup, Spectrum } from "../shared/brand/index.tsx";

export function SparkSplash({ error }: { error?: string }) {
  return (
    <div className="spark-splash" role={error ? "alert" : "status"}>
      <div className="spark-splash-inner">
        <SparkLockup />
        <Spectrum />
        <span className="spark-kicker">{BRAND.descriptor}</span>
        {error && (
          <p className="text-muted-foreground max-w-96 text-center text-xs leading-relaxed wrap-anywhere">
            Ouverture de {BRAND.name} impossible. {error}
          </p>
        )}
      </div>
    </div>
  );
}
