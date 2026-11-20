// The player profile: a drawer that opens from anywhere and expands to full.
// Conclusion first (tier, role fit, staff words), numbers one click away (attributes vs average).
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Face } from './graphics';
import { fmtM, type Player } from './mock';
import {
  GROUPS,
  attrsOf,
  careerOf,
  contractValue,
  fitsOf,
  isOurs,
  potential,
  staffOf,
  stars,
  tierOf,
  type Attr,
} from './profile';
import { usePv } from './store';

const arrow = (t: Attr['tone']) => (t === 'up' ? '▲' : t === 'down' ? '▼' : '');

function Bar({ a, fog }: { a: Attr; fog: boolean }) {
  const pc = (n: number) => `${(n / 20) * 100}%`;
  return (
    <div className={`at ${a.tone}`}>
      <span>{a.name}</span>
      <div className="at-track" aria-hidden>
        {fog ? (
          <i className="at-rng" style={{ left: pc(a.lo), width: pc(a.hi - a.lo + 0.6) }} />
        ) : (
          <i className="at-fill" style={{ width: pc(a.v) }} />
        )}
        <u style={{ left: pc(a.avg) }} title={`Position average ${a.avg.toFixed(1)}`} />
      </div>
      <b>
        {fog ? `${a.lo}–${a.hi}` : a.v}
        <em>{arrow(a.tone)}</em>
      </b>
    </div>
  );
}

export function Profile({
  pl,
  open,
  close,
}: {
  pl: Player;
  open: (id: string, m?: 'trade' | 'extend') => void;
  close: () => void;
}) {
  const { ovr, scouted, scoutMore, signed: sg } = usePv();
  const [full, setFull] = useState(false);
  const ours = isOurs(pl.id);
  const level = ours ? 3 : (scouted[pl.id] ?? 0);
  const fog = level < 3;
  const as = attrsOf(pl, level);
  const fits = fitsOf(pl, level);
  const [pLo, pHi] = potential(pl, level);
  const cv = contractValue(pl);
  const signed = sg[pl.id];
  const y = signed?.years ?? pl.years;
  return (
    <div className={`pf ${full ? 'full' : ''}`}>
      <div className="pf-hero">
        <motion.div
          layoutId={`ph-${pl.id}`}
          className="pf-ph"
          transition={{ type: 'spring', stiffness: 420, damping: 40 }}
        >
          <Face id={pl.id} team={ours ? 'MTL' : 'OTT'} num={pl.num} />
        </motion.div>
        <div className="pf-id">
          <span className="lbl">
            #{pl.num} · {pl.pos} · {pl.age} · {pl.ht} · shoots {pl.shoots}
          </span>
          <h2>{pl.name}</h2>
          <div className="pf-tier">
            {tierOf(pl)}
            {ovr && <b className="acc"> · OVR {pl.ovr}</b>}
          </div>
          {fog && (
            <div className="pf-fog">
              Scouting {level}/3 · ranges are estimates
              <button className="btn" onClick={() => scoutMore(pl.id)}>
                Send a scout
              </button>
            </div>
          )}
        </div>
        <div className="pf-tools">
          <button className="btn" onClick={() => setFull(!full)}>
            {full ? 'Compact' : 'Expand'}
          </button>
          <button className="btn" onClick={close}>
            Esc
          </button>
        </div>
      </div>

      <div className="pf-body">
        <div className="pf-col">
          <div className="lbl">Staff say</div>
          {staffOf(pl, level).map((s) => (
            <p className="pf-say" key={s.who}>
              <b>{s.who}</b>
              {s.says}
            </p>
          ))}

          <div className="lbl">Role fit{fog ? ' · estimate' : ''}</div>
          <div className="pf-fits">
            {fits.map((f) => (
              <div key={f.role}>
                <span>{f.role}</span>
                <i className={f.stars >= 4 ? 'hi' : ''}>{stars(f.stars)}</i>
              </div>
            ))}
          </div>

          <div className="kv pf-kv">
            <div>
              <b>{fmtM(signed?.amount ?? pl.capHit)}</b>
              <span className="lbl">Cap hit</span>
              <span className="pf-cv">{cv.word}</span>
            </div>
            <div>
              <b>{y}</b>
              <span className="lbl">{y === 1 ? 'Year left' : 'Years left'}</span>
            </div>
            <div>
              <b>
                {pLo}–{pHi}
              </b>
              <span className="lbl">Potential (range)</span>
            </div>
          </div>
          <div className="acts">
            {ours ? (
              <>
                <button className="btn pri" onClick={() => open(pl.id, 'extend')}>
                  Extend <span style={{ opacity: 0.6, marginLeft: 6 }}>E</span>
                </button>
                <button className="btn" onClick={() => open(pl.id, 'trade')}>
                  Trade <span style={{ opacity: 0.5, marginLeft: 6 }}>T</span>
                </button>
                <button className="btn">Shop</button>
              </>
            ) : (
              <button className="btn pri" onClick={() => scoutMore(pl.id)}>
                Scout
              </button>
            )}
          </div>
        </div>

        <div className="pf-col">
          <div className="lbl">
            Attributes · 1–20 · tick ={' '}
            {pl.pos === 'D' ? 'defenceman' : pl.pos === 'G' ? 'goalie' : 'forward'} average
          </div>
          {GROUPS.map((g) => (
            <div className="pf-grp" key={g}>
              <h4>{g}</h4>
              {as
                .filter((a) => a.group === g)
                .map((a) => (
                  <Bar key={a.name} a={a} fog={fog} />
                ))}
            </div>
          ))}
        </div>

        {full && (
          <div className="pf-col">
            <div className="lbl">Career</div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Season</th>
                  <th>GP</th>
                  <th>G</th>
                  <th>A</th>
                  <th>P</th>
                </tr>
              </thead>
              <tbody>
                {careerOf(pl).map((c) => (
                  <tr key={c.yr}>
                    <td>{c.yr}</td>
                    <td>{c.gp}</td>
                    <td>{c.g}</td>
                    <td>{c.a}</td>
                    <td>
                      <b>{c.g + c.a}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pl.traits.map((t) => (
              <span className="tag" key={t}>
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
