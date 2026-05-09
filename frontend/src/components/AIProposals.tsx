import { useState } from "react";

interface AIProposal {
  ticker: string;
  allocation_amount?: number;
  estimated_price?: number;
  shares?: number;
  time_horizon?: string;
  risk_level?: string;
  rationale?: string;
  detailed_analysis?: string;
  region?: string;
  cap_tier?: string;
  sector?: string;
  action?: string;
  exit_strategy?: string;
  target_price_bull?: number;
  target_price_base?: number;
  target_price_bear?: number;
}

interface AIProposalsProps {
  proposals: AIProposal[];
  onDismiss: () => void;
  onAdd: (p: AIProposal) => void;
  onConsult: (feedback: string) => void;
}

export function AIProposals({ proposals, onDismiss, onAdd, onConsult }: AIProposalsProps) {
  const [selectedAnalysis, setSelectedAnalysis] = useState<string | null>(null);

  return (
    <div className="dark bg-obsidian-base rounded-2xl border border-white/5 overflow-hidden font-body-md my-4">
      {/* Header */}
      <div className="px-8 py-6 border-b border-white/5 flex justify-between items-center bg-surface-container">
        <div>
          <h2 className="font-display-xl text-3xl font-bold text-white mb-1">AI Stock Suggestions</h2>
          <p className="font-body-lg text-sm text-on-surface-variant">Proprietary deep learning models have identified high-conviction opportunities.</p>
        </div>
        <button onClick={onDismiss} className="p-2 text-on-surface-variant hover:text-white hover:bg-white/5 rounded-lg transition-colors">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      {/* Grid */}
      <div className="p-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {proposals.map((p, i) => {
          const isHighRisk = p.risk_level?.toLowerCase().includes("high");
          const isLowRisk = p.risk_level?.toLowerCase().includes("low");
          
          return (
            <div key={i} className="glass-card rounded-2xl p-6 flex flex-col group relative overflow-hidden bg-white/[0.02]">
              <div className="absolute inset-0 bg-gradient-to-br from-primary-container/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
              
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="font-headline-lg text-2xl font-bold text-white mb-1">{p.ticker}</h3>
                  <span className="font-label-sm text-xs text-on-surface-variant tracking-wider uppercase">{p.sector || p.region || 'Equity'}</span>
                </div>
                <div className="flex items-center gap-2 bg-[#211F36] border border-white/5 px-3 py-1.5 rounded-full">
                  <div className={`w-2 h-2 rounded-full ${isHighRisk ? 'bg-error' : isLowRisk ? 'bg-primary-container' : 'bg-tertiary-container'}`}></div>
                  <span className="font-label-sm text-xs text-on-surface-variant">{p.risk_level || 'Medium'}</span>
                </div>
              </div>

              <div className="flex justify-between items-end mb-6">
                <div>
                  <div className="font-label-sm text-xs text-on-surface-variant mb-1 uppercase tracking-widest">Allocation Target</div>
                  <div className="font-headline-md text-2xl font-semibold text-primary-container glow-text">
                    ${(p.allocation_amount || (p.estimated_price! * p.shares!)).toLocaleString()}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-label-sm text-xs text-on-surface-variant mb-1 uppercase tracking-widest">Est. Shares</div>
                  <div className="font-body-lg text-lg text-white">~{p.shares}</div>
                </div>
              </div>

              <p className="font-body-md text-sm text-on-surface-variant mb-4 flex-1">
                {p.rationale}
              </p>

              {(p.target_price_bull || p.exit_strategy) && (
                <div className="bg-black/20 rounded-xl p-4 mb-6 border border-white/5">
                  <div className="flex justify-between items-center mb-3">
                    <span className="font-label-sm text-xs text-on-surface-variant uppercase tracking-widest">Scenarios</span>
                    <span className={`font-label-sm text-xs font-bold px-2 py-1 rounded ${
                      p.action?.toUpperCase() === 'BUY' ? 'bg-primary-container text-on-primary' : 
                      p.action?.toUpperCase() === 'SELL' ? 'bg-error text-on-error' : 
                      'bg-tertiary-container text-black'
                    }`}>
                      {p.action || 'BUY'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div>
                      <div className="text-[10px] text-primary-container uppercase tracking-widest">Bull</div>
                      <div className="font-headline-sm text-sm text-white">${p.target_price_bull || '-'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-on-surface-variant uppercase tracking-widest">Base</div>
                      <div className="font-headline-sm text-sm text-white">${p.target_price_base || '-'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-error uppercase tracking-widest">Bear</div>
                      <div className="font-headline-sm text-sm text-white">${p.target_price_bear || '-'}</div>
                    </div>
                  </div>
                  {p.exit_strategy && (
                    <div className="text-xs text-on-surface-variant leading-relaxed">
                      <span className="text-white/70 font-semibold">Exit:</span> {p.exit_strategy}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between mt-auto gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-on-surface-variant text-sm">schedule</span>
                  <span className="font-label-sm text-xs text-on-surface-variant">{p.time_horizon || '1-3 Years'}</span>
                </div>
                
                <div className="flex items-center gap-2">
                  {p.detailed_analysis && (
                    <button 
                      onClick={() => setSelectedAnalysis(p.detailed_analysis || null)}
                      className="bg-white/5 hover:bg-white/10 border border-white/10 font-label-sm text-xs text-white px-3 py-2 rounded-lg backdrop-blur-md transition-all"
                    >
                      Deep Analysis
                    </button>
                  )}
                  <button 
                    onClick={() => onAdd(p)}
                    className="bg-primary-container text-[#050505] hover:bg-primary-fixed font-label-sm text-xs px-3 py-2 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">add</span> Add
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Insight Section */}
      <section className="obsidian-section m-8 rounded-3xl p-8 lg:p-12 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary-container/5 rounded-full blur-[100px] pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-secondary-container/5 rounded-full blur-[100px] pointer-events-none"></div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 relative z-10">
          <div className="lg:col-span-5 flex flex-col justify-center">
            <div className="inline-flex items-center gap-2 bg-primary-container/10 border border-primary-container/20 rounded-full px-4 py-2 mb-6 self-start">
              <span className="material-symbols-outlined text-primary-container text-sm">auto_awesome</span>
              <span className="font-label-sm text-xs text-primary-container uppercase tracking-widest">Alpha Signals</span>
            </div>
            <h2 className="font-display-xl text-3xl font-bold text-white mb-6">Why These Assets?</h2>
            <p className="font-body-lg text-base text-on-surface-variant mb-8">
              Our models analyze over 10,000 data points per second, cross-referencing traditional fundamentals with alternative data streams including satellite imagery, patent filings, and executive sentiment.
            </p>
          </div>
          <div className="lg:col-span-7 grid grid-cols-2 gap-4">
            <div className="glass-card rounded-2xl p-6 bg-white/[0.02]">
              <span className="material-symbols-outlined text-primary-container text-3xl mb-4">memory</span>
              <h4 className="font-headline-md text-lg font-semibold text-white mb-2">Compute Dominance</h4>
              <p className="font-body-md text-sm text-on-surface-variant">Selected assets hold monopolistic characteristics in next-gen compute infrastructure.</p>
            </div>
            <div className="glass-card rounded-2xl p-6 bg-white/[0.02] translate-y-8">
              <span className="material-symbols-outlined text-primary-container text-3xl mb-4">trending_up</span>
              <h4 className="font-headline-md text-lg font-semibold text-white mb-2">Margin Expansion</h4>
              <p className="font-body-md text-sm text-on-surface-variant">High probability of operating margin expansion driven by AI-enabled efficiencies.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Consult Analyst Bar */}
      <div className="px-8 py-6 border-t border-white/5 bg-surface-container-low flex gap-4 items-center">
        <span className="material-symbols-outlined text-on-surface-variant">chat</span>
        <input 
          type="text" 
          placeholder="Feedback for Junior Analyst... (e.g. 'Redo with more tech focus' or 'Reduce risk')"
          className="flex-1 bg-black/20 border border-white/10 rounded-xl py-3 px-4 text-white focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-colors placeholder-on-surface-variant/50"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
              onConsult(e.currentTarget.value.trim());
              e.currentTarget.value = '';
            }
          }}
        />
        <button 
          className="bg-primary-container text-[#050505] font-label-sm uppercase tracking-widest px-6 py-3 rounded-xl hover:bg-primary-fixed transition-colors whitespace-nowrap"
          onClick={(e) => {
            const input = e.currentTarget.previousElementSibling as HTMLInputElement;
            if (input.value.trim()) {
              onConsult(input.value.trim());
              input.value = '';
            }
          }}
        >
          Consult Analyst
        </button>
      </div>

      {/* Analysis Modal */}
      {selectedAnalysis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedAnalysis(null)}>
          <div className="bg-surface-container border border-white/10 rounded-2xl p-8 max-w-2xl w-full text-white shadow-2xl relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setSelectedAnalysis(null)} className="absolute top-4 right-4 text-on-surface-variant hover:text-white">
              <span className="material-symbols-outlined">close</span>
            </button>
            <div className="inline-flex items-center gap-2 bg-primary-container/10 border border-primary-container/20 rounded-full px-3 py-1 mb-4">
              <span className="material-symbols-outlined text-primary-container text-sm">psychology</span>
              <span className="font-label-sm text-xs text-primary-container uppercase tracking-widest">Deep Analysis</span>
            </div>
            <h3 className="text-2xl font-bold mb-4 font-display-xl">AI Reasoning</h3>
            <p className="text-on-surface-variant leading-relaxed whitespace-pre-wrap text-sm">{selectedAnalysis}</p>
          </div>
        </div>
      )}
    </div>
  );
}
