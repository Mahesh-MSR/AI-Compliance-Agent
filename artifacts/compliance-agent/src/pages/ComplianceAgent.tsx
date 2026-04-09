import { useState, useRef, useEffect } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle,
  Loader2,
  ChevronDown,
  RotateCcw,
  Key,
  Eye,
  EyeOff,
  ExternalLink,
} from "lucide-react";

const INDUSTRIES = [
  { value: "general", label: "General" },
  { value: "healthcare", label: "Healthcare (HIPAA)" },
  { value: "finance", label: "Finance (SOX / PCI-DSS)" },
  { value: "manufacturing", label: "Manufacturing (ISO / OSHA)" },
];

const API_KEY_STORAGE = "openrouter_api_key";

interface ComplianceResult {
  extractedData: string;
  extractedRules: string;
  violations: string[];
  riskLevel: string;
  recommendations: string;
  score: number;
}

function parseMarkdownSection(text: string, heading: string): string {
  const regex = new RegExp(
    `###\\s*${heading}\\s*\\n([\\s\\S]*?)(?=###|$)`,
    "i"
  );
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}

function parseViolations(text: string): string[] {
  const raw = parseMarkdownSection(text, "Violations");
  if (!raw) return [];
  if (/no violations found/i.test(raw) || /none/i.test(raw.slice(0, 80))) {
    return [];
  }
  return raw
    .split("\n")
    .map((l) => l.replace(/^[-*\d.]\s*/, "").trim())
    .filter((l) => l.length > 0);
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  return "text-red-600";
}

function scoreBarColor(score: number): string {
  if (score >= 80) return "bg-green-500";
  if (score >= 50) return "bg-yellow-500";
  return "bg-red-500";
}

function riskBadgeColor(risk: string): string {
  const lower = risk.toLowerCase();
  if (lower.includes("low")) return "bg-green-100 text-green-800 border-green-200";
  if (lower.includes("medium") || lower.includes("moderate"))
    return "bg-yellow-100 text-yellow-800 border-yellow-200";
  if (lower.includes("high") || lower.includes("critical"))
    return "bg-red-100 text-red-800 border-red-200";
  return "bg-gray-100 text-gray-800 border-gray-200";
}

function RiskIcon({ risk }: { risk: string }) {
  const lower = risk.toLowerCase();
  if (lower.includes("low")) return <CheckCircle className="w-4 h-4 text-green-600" />;
  return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
}

function SectionCard({
  title,
  children,
  accent,
}: {
  title: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className={`rounded-xl border bg-card shadow-sm overflow-hidden ${accent ? "border-l-4 " + accent : ""}`}>
      <div className="px-5 py-3 border-b bg-muted/40">
        <h3 className="font-semibold text-sm text-foreground tracking-wide uppercase opacity-70">
          {title}
        </h3>
      </div>
      <div className="px-5 py-4 text-sm text-foreground leading-relaxed">
        {children}
      </div>
    </div>
  );
}

export default function ComplianceAgent() {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [apiKeySaved, setApiKeySaved] = useState(false);

  const [companyData, setCompanyData] = useState("");
  const [rules, setRules] = useState("");
  const [industry, setIndustry] = useState("general");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ComplianceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Load saved API key from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(API_KEY_STORAGE);
    if (saved) {
      setApiKey(saved);
      setApiKeySaved(true);
    }
  }, []);

  function saveApiKey() {
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    localStorage.setItem(API_KEY_STORAGE, trimmed);
    setApiKey(trimmed);
    setApiKeySaved(true);
  }

  function clearApiKey() {
    localStorage.removeItem(API_KEY_STORAGE);
    setApiKey("");
    setApiKeySaved(false);
  }

  async function runAgent() {
    const key = apiKey.trim();
    if (!key) {
      setError("Please enter your OpenRouter API key above.");
      return;
    }
    if (!companyData.trim() || !rules.trim()) {
      setError("Please fill in both Company Data and Compliance Rules.");
      return;
    }

    setError(null);
    setResult(null);
    setLoading(true);

    const selectedIndustry =
      INDUSTRIES.find((i) => i.value === industry)?.label ?? "General";

    const prompt = `You are a strict compliance auditor specializing in ${selectedIndustry} regulations.

Analyze the following input carefully:

COMPANY DATA:
${companyData}

COMPLIANCE RULES:
${rules}

Instructions:
- Extract company data points
- Extract compliance rules
- Compare logically and rigorously
- Identify ONLY real violations (do not hallucinate)
- Assign a risk level (Low / Medium / High / Critical)
- Suggest actionable recommendations

If no violations are found, clearly state "No violations found."

Format your response using EXACTLY these headings:
### Extracted Data
### Extracted Rules
### Violations
### Risk Level
### Recommendations`;

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": window.location.origin,
          "X-Title": "AI Compliance Agent",
        },
        body: JSON.stringify({
          model: "openrouter/auto",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        let friendly = `API error ${response.status}`;
        try {
          const parsed = JSON.parse(errBody);
          friendly += `: ${parsed?.error?.message ?? errBody}`;
        } catch {
          friendly += `: ${errBody}`;
        }
        if (response.status === 401) {
          friendly =
            "Invalid API key. Please check your OpenRouter key and try again.";
        }
        throw new Error(friendly);
      }

      const data = await response.json();
      const text: string = data.choices?.[0]?.message?.content ?? "";

      const violations = parseViolations(text);
      const score = Math.max(0, 100 - violations.length * 20);

      setResult({
        extractedData: parseMarkdownSection(text, "Extracted Data"),
        extractedRules: parseMarkdownSection(text, "Extracted Rules"),
        violations,
        riskLevel: parseMarkdownSection(text, "Risk Level"),
        recommendations: parseMarkdownSection(text, "Recommendations"),
        score,
      });

      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setResult(null);
    setError(null);
    setCompanyData("");
    setRules("");
    setIndustry("general");
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
            <ShieldCheck className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            AI Compliance Agent
          </h1>
          <p className="mt-2 text-muted-foreground text-base max-w-lg mx-auto">
            Paste your company data and compliance rules. The AI will audit
            them, identify violations, and generate a compliance score.
          </p>
        </div>

        {/* API Key Card */}
        <div className="rounded-2xl border bg-card shadow-sm p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Key className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">
              OpenRouter API Key
            </span>
            {apiKeySaved && (
              <span className="ml-auto text-xs text-green-600 font-medium bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                Saved locally
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Your key is stored only in your browser — never sent anywhere except
            directly to OpenRouter.{" "}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary inline-flex items-center gap-0.5 hover:underline"
            >
              Get a free key <ExternalLink className="w-3 h-3" />
            </a>
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setApiKeySaved(false);
                }}
                placeholder="sk-or-v1-..."
                className="w-full rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition font-mono"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
                tabIndex={-1}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              onClick={saveApiKey}
              disabled={!apiKey.trim() || apiKeySaved}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save
            </button>
            {apiKeySaved && (
              <button
                onClick={clearApiKey}
                className="px-3 py-2 rounded-lg border border-input text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Input Card */}
        <div className="rounded-2xl border bg-card shadow-sm p-6 mb-6 space-y-5">
          {/* Industry Selector */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Industry
            </label>
            <div className="relative">
              <select
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="w-full appearance-none rounded-lg border border-input bg-background px-4 py-2.5 pr-10 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
              >
                {INDUSTRIES.map((ind) => (
                  <option key={ind.value} value={ind.value}>
                    {ind.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* Company Data */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Company Data
            </label>
            <textarea
              value={companyData}
              onChange={(e) => setCompanyData(e.target.value)}
              rows={6}
              placeholder={`Paste your company's operational data, policies, or practices here...\n\nExample: Our company stores patient records without encryption. Employees share login credentials. We do not conduct annual security audits.`}
              className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y transition"
            />
          </div>

          {/* Compliance Rules */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Compliance Rules
            </label>
            <textarea
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={6}
              placeholder={`Enter the compliance rules, regulations, or standards to check against...\n\nExample: All patient records must be encrypted at rest and in transit. Each employee must have unique login credentials. Annual security audits are mandatory.`}
              className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y transition"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={runAgent}
              disabled={loading}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 active:scale-95 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  Run Compliance Agent
                </>
              )}
            </button>
            {result && (
              <button
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-lg border border-input bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition"
              >
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="rounded-2xl border bg-card shadow-sm p-6 space-y-4 animate-pulse">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-4 w-32 bg-muted rounded" />
                <div className="h-16 bg-muted rounded-lg" />
              </div>
            ))}
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div ref={resultRef} className="space-y-4">
            {/* Score Banner */}
            <div className="rounded-2xl border bg-card shadow-sm p-6">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                    Compliance Score
                  </p>
                  <p className={`text-5xl font-bold tabular-nums ${scoreColor(result.score)}`}>
                    {result.score}
                    <span className="text-2xl text-muted-foreground font-normal">/100</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                    Risk Level
                  </p>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-semibold ${riskBadgeColor(result.riskLevel)}`}>
                    <RiskIcon risk={result.riskLevel} />
                    {result.riskLevel || "Unknown"}
                  </span>
                </div>
              </div>
              <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                <div
                  className={`h-2.5 rounded-full transition-all duration-700 ${scoreBarColor(result.score)}`}
                  style={{ width: `${result.score}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {result.violations.length === 0
                  ? "No violations detected. Full compliance achieved."
                  : `${result.violations.length} violation${result.violations.length > 1 ? "s" : ""} found — 20 points deducted per violation.`}
              </p>
            </div>

            {/* Violations */}
            <SectionCard
              title={`Violations (${result.violations.length})`}
              accent={result.violations.length > 0 ? "border-l-red-500" : "border-l-green-500"}
            >
              {result.violations.length === 0 ? (
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">No violations found. Fully compliant.</span>
                </div>
              ) : (
                <ul className="space-y-2">
                  {result.violations.map((v, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-red-100 border border-red-200 flex items-center justify-center text-red-700 text-xs font-bold">
                        {i + 1}
                      </span>
                      <span>{v}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            {result.recommendations && (
              <SectionCard title="Recommendations" accent="border-l-blue-500">
                <div className="whitespace-pre-wrap">{result.recommendations}</div>
              </SectionCard>
            )}

            {result.extractedData && (
              <SectionCard title="Extracted Company Data">
                <div className="whitespace-pre-wrap text-muted-foreground">{result.extractedData}</div>
              </SectionCard>
            )}

            {result.extractedRules && (
              <SectionCard title="Extracted Compliance Rules">
                <div className="whitespace-pre-wrap text-muted-foreground">{result.extractedRules}</div>
              </SectionCard>
            )}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground mt-10">
          Powered by OpenRouter AI &mdash; Results should be reviewed by a qualified compliance professional.
        </p>
      </div>
    </div>
  );
}
