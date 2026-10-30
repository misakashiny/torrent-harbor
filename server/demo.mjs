import { MiB } from './engine.mjs';
const names = [ 'Planet Earth III · 地球脉动 第三季', 'The Grand Budapest Hotel · 布达佩斯大饭店', 'Interstellar · 星际穿越', 'BBC Blue Planet II · 蓝色星球', 'Dune Part Two · 沙丘2', 'The Lord of the Rings · 指环王', 'A Perfect Planet · 完美星球', 'Our Planet · 我们的星球', 'The Secret Life of Walter Mitty · 白日梦想家', 'In the Mood for Love · 花样年华', 'Blade Runner 2049 · 银翼杀手', 'The Green Planet · 绿色星球' ];
export class DemoAdapter {
  constructor(client) { this.client = client; this.limits = new Map(); }
  quantize(v) { return v == null ? null : Math.floor(v); }
  async snapshot() {
    const index = ['demo-qb1','demo-tr1','demo-qb2'].indexOf(this.client.id), tick = Date.now()/10000;
    const torrents = Array.from({length:12},(_,i) => {
      const id = `demo-${index}-${i}`, site = ['north','orbit','forest'][(i+index)%3];
      const state = i < 3 && index !== 1 ? 'downloading' : i === 11 ? 'paused' : 'seeding';
      const limits = this.limits.get(id) || { upload:null, download:null };
      const wave = .7 + .25*Math.sin(tick*.6+i+index);
      return { id, hash:`${index}${String(i).padStart(39,'0')}`, name:`${names[(i+index*3)%names.length]} ${i%2 ? '1080p BluRay':'2160p UHD'}`, progress:state === 'downloading' ? .18+i*.24 : 1, size:(12+i*4)*1024**3, uploaded:(32+i*7)*1024**3, downloaded:(10+i*3)*1024**3, ratio:2.1+i*.8, upload:state === 'paused' ? 0 : Math.min((.3+(i%4)*.6)*MiB*wave, limits.upload ?? Infinity), download:state === 'downloading' ? Math.min((8+i*9)*MiB*wave,limits.download ?? Infinity):0, uploadLimit:limits.upload, downloadLimit:limits.download, tags:state === 'seeding' ? ['保种',i%2 ? '纪录片':'电影'] : ['下载中',i === 0 ? '急用':'电影'], category:i%2 ? 'Documentary':'Movies', hosts:[`${site}.example`], metadataReady:true, state };
    });
    const upload=torrents.reduce((s,t)=>s+t.upload,0),download=torrents.reduce((s,t)=>s+t.download,0),now=Date.now();
    this.trafficUpload=(this.trafficUpload??torrents.reduce((s,t)=>s+t.uploaded,0))+upload*Math.max(0,now-(this.trafficTime??now))/1000;
    this.trafficDownload=(this.trafficDownload??torrents.reduce((s,t)=>s+t.downloaded,0))+download*Math.max(0,now-(this.trafficTime??now))/1000;this.trafficTime=now;
    return { version:this.client.type === 'qb' ? 'v5.1 · 模拟':'4.1 · 模拟', upload, download, traffic:{upload:this.trafficUpload,download:this.trafficDownload,lifetime:true,source:'demo-counters'}, native:{upload:null,download:null,alternative:false,note:'独立演示环境，不连接真实下载器'}, torrents };
  }
  async setLimit(id, direction, value) { this.limits.set(id,{ ...(this.limits.get(id)||{upload:null,download:null}),[direction]:value }); }
  async readLimit(id, direction) { return this.limits.get(id)?.[direction] ?? null; }
}
