'use strict';
// Redis simulado (subconjunto usado pela audiência), com relógio controlado e contagem de
// comandos. Usado nos testes e no simulador de consumo; nenhum serviço real é acessado.
class RedisFalso {
  constructor(relogio) { this.relogio = relogio; this.kv = new Map(); this.exp = new Map(); this.comandos = 0; this.requisicoes = 0; this.falhar = false; }
  vivo(k) { const e = this.exp.get(k); if (e !== undefined && e <= this.relogio()) { this.kv.delete(k); this.exp.delete(k); } return this.kv.has(k); }
  get(k) { return this.vivo(k) ? this.kv.get(k) : undefined; }
  run([cmd, k, ...a]) {
    this.comandos++;
    switch (cmd) {
      case 'GET': { const v = this.get(k); return v === undefined ? null : String(v); }
      case 'MGET': return [k, ...a].map(x => { const v = this.get(x); return v === undefined ? null : String(v); });
      case 'SET': { if (a.includes('NX') && this.vivo(k)) return null; this.kv.set(k, String(a[0])); const i = a.indexOf('EX'); if (i >= 0) this.exp.set(k, this.relogio() + Number(a[i + 1]) * 1000); else this.exp.delete(k); return 'OK'; }
      case 'INCR': case 'INCRBY': { const v = Number(this.get(k) || 0) + (cmd === 'INCR' ? 1 : Number(a[0])); this.kv.set(k, String(v)); return v; }
      case 'INCRBYFLOAT': { const v = Number(this.get(k) || 0) + Number(a[0]); this.kv.set(k, String(v)); return String(v); }
      case 'EXPIRE': { if (!this.vivo(k)) return 0; this.exp.set(k, this.relogio() + Number(a[0]) * 1000); return 1; }
      case 'ZADD': { const z = this.get(k) || new Map(); z.set(a[1], Number(a[0])); this.kv.set(k, z); return 1; }
      case 'ZREMRANGEBYSCORE': { const z = this.get(k); if (!z) return 0; let n = 0; for (const [m, s] of z) if (s >= Number(a[0]) && s <= Number(a[1])) { z.delete(m); n++; } return n; }
      case 'ZCARD': { const z = this.get(k); return z ? z.size : 0; }
      case 'ZRANGE': { const z = this.get(k); return z ? [...z.keys()] : []; }
      case 'PFADD': { const s = this.get(k) || new Set(); const antes = s.size; s.add(a[0]); this.kv.set(k, s); return s.size > antes ? 1 : 0; }
      case 'PFCOUNT': { const s = this.get(k); return s ? s.size : 0; }
      default: throw new Error('comando não simulado: ' + cmd);
    }
  }
  // Interface de armazenamento usada por lib/audiencia.js (pipeline).
  armazenamento() {
    return { exec: async cmds => { this.requisicoes++; if (this.falhar) throw new Error('Redis indisponível'); return cmds.map(c => this.run(c)); } };
  }
}
module.exports = { RedisFalso };
