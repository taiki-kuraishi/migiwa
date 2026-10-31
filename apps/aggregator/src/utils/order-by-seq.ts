/**
 * 受けた時刻の順に並んだ変化のうち、同じ ms・同じ session で seq のあるものを、それらがいた位置のまま seq の順
 * に並べ替える。ほかの変化は位置を変えない。
 */
// 同じ ms に届いた変化（RESUME の再送など）は、ほかの列の順にすると online → offline が逆になり、offline の
// user を online のまま延ばしてしまう。seq は session の中でしか比べられないので、比較関数で sort すると別
// session や seq の無い変化を挟んだときに順序が推移的でなくなる。位置ごとに入れ替えて、挟まれても seq の順に
// する。
export const orderBySeq = <T extends { receivedAt: Date; sessionId: string; seq: number | null }>(
  updates: T[],
) => {
  const ordered = [...updates];
  const groups = Map.groupBy(
    ordered.flatMap((update, position) =>
      update.seq === null ? [] : [{ update, position, seq: update.seq }],
    ),
    ({ update }) => `${update.receivedAt.getTime()}/${update.sessionId}`,
  );
  for (const group of groups.values()) {
    const positions = group.map(({ position }) => position);
    const bySeq = group.toSorted((a, b) => a.seq - b.seq);
    for (const [index, { update }] of bySeq.entries()) {
      ordered.splice(positions[index] ?? ordered.length, 1, update);
    }
  }
  return ordered;
};
