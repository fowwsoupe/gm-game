import { useState } from 'react';
import { ATLANTIC, FA_BOARD, METRO, PROSPECTS, pts, type Row } from './mock';
import { Num } from './parts';
import { usePv } from './store';

const Head = ({ k, t, children }: { k: string; t: string; children?: React.ReactNode }) => (
  <div className="ro-head">
    <div>
      <span className="lbl">{k}</span>
      <h1>{t}</h1>
    </div>
    <div className="stat">{children}</div>
  </div>
);

const Table = ({ rows }: { rows: (Row & { p: number })[] }) => (
  <table className="tbl">
    <thead>
      <tr>
        <th>Team</th>
        <th>GP</th>
        <th>W</th>
        <th>L</th>
        <th>OTL</th>
        <th>PTS</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((r, i) => (
        <tr key={r.ab} className={`${r.ab === 'MTL' ? 'me' : ''} ${i === 2 ? 'cut' : ''}`}>
          <td>
            {i + 1}. {r.name}
          </td>
          <td>{r.gp}</td>
          <td>{r.w}</td>
          <td>{r.l}</td>
          <td>{r.otl}</td>
          <td>
            <b>{r.p}</b>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);
const rank = (r: Row[]) => r.map((x) => ({ ...x, p: pts(x) })).sort((a, b) => b.p - a.p);

export function League() {
  return (
    <>
      <Head k="2026–27 · Eastern Conference" t="League" />
      <div className="two" style={{ gap: 40 }}>
        <section>
          <div className="col-h">
            <h2>Atlantic</h2>
          </div>
          <Table rows={rank(ATLANTIC)} />
        </section>
        <section>
          <div className="col-h">
            <h2>Metropolitan</h2>
          </div>
          <Table rows={rank(METRO)} />
        </section>
      </div>
    </>
  );
}

export function Market() {
  const say = usePv((s) => s.say);
  const [q, setQ] = useState('');
  const rows = FA_BOARD.filter((r) => `${r.name} ${r.pos}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <Head k="Free agents and trade targets" t="Market">
        <input
          className="filter"
          placeholder="Filter by name or position"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </Head>
      <table className="tbl">
        <thead>
          <tr>
            <th>Player</th>
            <th>Pos</th>
            <th>Age</th>
            <th>OVR</th>
            <th>Asks</th>
            <th>Interest</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{r.pos}</td>
              <td>{r.age}</td>
              <td>
                <b>{r.ovr}</b>
              </td>
              <td>{r.ask}</td>
              <td>{r.interest}</td>
              <td>
                <button
                  className="btn"
                  onClick={() => say(`Offer sent to ${r.name}. Preview only.`)}
                >
                  Make offer
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function Scout() {
  return (
    <>
      <Head k="2027 draft class" t="Scout" />
      <table className="tbl">
        <thead>
          <tr>
            <th>Rank</th>
            <th>#</th>
            <th>Prospect</th>
            <th>Pos</th>
            <th>Age</th>
            <th>Proj. OVR</th>
            <th>From</th>
          </tr>
        </thead>
        <tbody>
          {[...PROSPECTS]
            .sort((a, b) => a.rank - b.rank)
            .map((r) => (
              <tr key={r.id}>
                <td>{r.rank}</td>
                <td>
                  <Num n={r.num} />
                </td>
                <td>{r.name}</td>
                <td>{r.pos}</td>
                <td>{r.age}</td>
                <td>
                  <b>{r.ovr}</b>
                </td>
                <td>{r.from}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </>
  );
}
