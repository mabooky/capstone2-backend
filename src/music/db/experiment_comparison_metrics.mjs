export const MODELS=['A','B1','B2','C1','C2'];
export const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
export function quantile(sorted,p) {
    if(!sorted.length) return null;
    const at=(sorted.length-1)*p,i=Math.floor(at);
    return sorted[i]+(sorted[Math.min(i+1,sorted.length-1)]-sorted[i])*(at-i);
}
export function statistics(xs) {
    const s=[...xs].sort((a,b)=>a-b),avg=mean(s);
    return {n:s.length,min:s[0]??null,max:s.at(-1)??null,mean:avg,median:quantile(s,.5),
        p01:quantile(s,.01),p25:quantile(s,.25),p75:quantile(s,.75),p99:quantile(s,.99),
        stddev:s.length?Math.sqrt(mean(s.map(x=>(x-avg)**2))):null};
}
export const quadrant=(v,a)=>(v<0?'-':'+')+(a<0?'-':'+');
export function targets() {
    const levels=[-1,-.5,0,.5,1],rows=[];
    for(const v of levels) for(const a of levels) rows.push({id:'t'+String(rows.length+1).padStart(2,'0'),
        valence:v,arousal:a,quadrant:quadrant(v,a),
        region:v===0&&a===0?'center':Math.abs(v)===1||Math.abs(a)===1?'boundary':v===0||a===0?'axis':'quadrant'});
    return rows;
}
export function overlap(left,right,k) {
    const l=new Map(left.map(r=>[r.song_id,r.rank])),r=new Map(right.map(r=>[r.song_id,r.rank]));
    const common=[...l.keys()].filter(id=>r.has(id)),union=l.size+r.size-common.length;
    return {intersection:common.length,overlap_at_k:common.length/k,
        jaccard:union?common.length/union:null,
        overlap_of_smaller_list:Math.min(l.size,r.size)?common.length/Math.min(l.size,r.size):null,
        same_rank_count:common.filter(id=>l.get(id)===r.get(id)).length,
        mean_shared_rank_gap:mean(common.map(id=>Math.abs(l.get(id)-r.get(id)))),
        top1_agreement:left.length&&right.length?left[0].song_id===right[0].song_id:null};
}
export function shape(points) {
    const v=statistics(points.map(p=>p[0])),a=statistics(points.map(p=>p[1]));
    const quadrantCounts={'--':0,'-+':0,'+-':0,'++':0};
    for(const [x,y] of points) quadrantCounts[quadrant(x,y)]++;
    const fences=s=>s.n?[s.p25-1.5*(s.p75-s.p25),s.p75+1.5*(s.p75-s.p25)]:[null,null];
    return {valence:v,arousal:a,quadrants:quadrantCounts,iqr_fences:{valence:fences(v),arousal:fences(a)}};
}
