const express = require("express");
const { randomUUID, createDecipheriv } = require("crypto");
const { readFileSync } = require("fs");
const { WebSocketServer, WebSocket } = require("ws");
const { createServer } = require("http");
const dns = require("dns");
const path = require("path");
const chalk = require("chalk");

if (!globalThis.crypto) globalThis.crypto = require("crypto").webcrypto;

const PORT = process.env.PORT || 3001;

let sites;
try {
  sites = JSON.parse(readFileSync(path.join(__dirname, "sites.json"), "utf-8"));
} catch (e) {
  console.error("Failed to load sites.json:", e);
  process.exit(1);
}

const RACCOON_HOST = "www.raccoongame.com";
const RACCOON_TIMEOUT_MS = 20_000;
let raccoonIpCache = null;

// ── malq (self-hosted temp-mail, bundled at ./malq in the deploy dir) ──────
// raccoongame.com blocked every mail.tm domain
// ("Temporary email addresses are not supported."), which killed the old
// account-creation flow. malq rotates across ~40 disposable-mail providers
// instead, and runs on an internal port next to this API — never exposed.
const MAIL_HOST = process.env.MALQ_HOST || "http://127.0.0.1:4400";
const VERIFY_TIMEOUT_MS = 45_000; // total budget for the code to arrive
const VERIFY_POLL_INTERVAL_MS = 2_000;

// Domains raccoongame still accepts (probed 2026-09-27). Override with
// MALQ_ALLOWED_DOMAINS env (comma-separated); set it to "," to disable the
// filter. Domains that answered anything other than a clean 200 (e.g. "The
// email domain cannot receive email") were left out — those inboxes never
// receive the code, which is the exact dead-inbox case this avoids.
const ACCEPTED_MAIL_DOMAINS = new Set(
  (process.env.MALQ_ALLOWED_DOMAINS || "0984764670ann.top,13teams.com,17666688.shop,1secmail.asia,1vpn.net,1weq.indevs.in,282mail.com,2fagmail.com,2famail.com,2fanote.com," +
      "2faqq.com,2faus.com,2mail.store,2thth.com,442587.xyz,5fa.live,69i.shop,88mail.sbs,88mail.space,91az.net," +
      "965.tmmad.com,aa55lamvinhkangzzzz.shop,aaa45longcakiazzzz.shop,aaa53nhanmaizzzz.com,aaaa879hangphongnizzzz.shop,aaakimanhcpfzz5zzz.shop,aaalamvinhanzzzz.shop,aaatranngochafczzzz.com,aauu.space,abematv.com," +
      "abematv.net,abematv.org,abjmail.sbs,abusultanvip.com,aceh.cc,addyson.space,adenofscamaccounts.health,adid.name.ng,admin.thanhori.click,agp.edu.pl," +
      "aihay.indevs.in,aiie.site,aistudioo.indevs.in,aksngmail.com,altaddress.com,altaddress.net,altaddress.org,ameliekovacek3.top,annnek.dpdns.org,annnek.indevs.in," +
      "annnekkk.dpdns.org,annnekkk.indevs.in,annnekkk.me,antdev.org,antipx.com,antjv.cc7.name.ng,app42.cc1.name.ng,app55.cc1.name.ng,apponi.site,apptool.indevs.in," +
      "apricity.tech,aquaflask.click,asdw.indevs.in,asfsadf2.pro,asia.1maill.com,asia.5secmail.com,asia.banglatip.com,asna.name.ng,astrixion.co.uk,astrixion.online," +
      "astrixion.store,atica.edus.edu.pl,avelixmail.pro,ayna.fun,azpopmail.com,ballerstreat.com,bangkabelitung.net,banq7.online,batchofgames.store,batchoftools.store," +
      "bayern.tokyo,bccto.cc,bd.1maill.com,bd.5secmail.com,beautystoremax.com,bedieusociu.tech,beeinbox.com,beeinbox.edu.pl,beeinbox.shop,beeinbox.space," +
      "bemh.zihiv.app,berlin.edus.edu.pl,bhsmail.online,bobmails.xyz,bokachoda.pro,bosv.poj.me,bozuyv.cc15.name.ng,bpl.ovh,bradyvalentin.top,brawlz.io," +
      "brewvn.com,brewvn.tokenized.name,brikanto.co.uk,brodilla.email,bszvq.enpy.me,burlingamezzz12.shop,businessfb.my.id,bygg.gvffm.app,byrur.cc7.name.ng,bzus.name.ng," +
      "cail.shop,camp.unibiz.edu.pl,campus.agp.edu.pl,canicasbrawl.com,careplusmedical.io.vn,castcross.com,cbdtfe.cc19.name.ng,cc13.name.ng,cc14.name.ng,cc7.name.ng," +
      "ccdeveloper.online,cctruyen.com,cfle.zolud.app,cfqs.name.ng,cheapluxury.dpdns.org,cheapluxury.indevs.in,cheapluxurymail.xyz,cheappoor.dpdns.org,chengge996.tech,chiasemienphi.indevs.in," +
      "chinasteel.xyz,chinpomail.com,chio-online.us.com,chowordpress.biz.id,chtsv.store,cmail.asia,codeviet.store,coding.publicvm.com,coffeechill.bond,coheuk.cc16.name.ng," +
      "community.tokenized.name,communitymmo.tokyo,congngheso.cyou,contact.edus.edu.pl,corpmail.club,cqxkcp.cc14.name.ng,creatorsagi.site,cronus.works,crush.web.id,cupang.tech," +
      "cursormoi.me,cursormoi.tech,cutiesgirlontheworld.indevs.in,cyclop.live,daddy.larping.agency,dailynewsdomain.com,dailypolicywatch.com,dasf.name.ng,dauv.name.ng,dbea.autos," +
      "ddzv.name.ng,deall.store,deislerlive.com,dev.semar.edu.pl,devlogtech.web.id,devvnapi.qzz.io,dfly.name.ng,dful.name.ng,dichvu.linkpc.net,diddybld.shop," +
      "diddyblud.shop,diddybluds.shop,diendanit.tokenized.name,diendanviet.sryze.cc,digitalcorevn.biz.id,disbs.com,disefl.com,disposemail.space,dnbp.hair,doestech.web.id," +
      "domainmoi.me,domainmoi.tech,domsr.fun,doro.name.ng,dowjones.com.se,dpl.ovh,dple.top,dqrx.name.ng,dramapendek.info,dramapendek.online," +
      "dropinbox.space,dryddtyioo.com,dtvj.name.ng,dua.unibiz.edu.pl,duanhqu7t1.top,dublin.edus.edu.pl,dulichviet.biz.id,dyb.delot.dev,dyql.zolud.app,easyme.pro," +
      "edging.life,edubaby.indevs.in,edugpt.bond,eduhust.online,eduinfo.indevs.in,edunews.indevs.in,edus.edu.pl,eeei.shop,eeii.store,eemail.shop," +
      "eemail.space,efemeral.tech,efhyo.cc7.name.ng,eisenlog.com,eko.unibiz.edu.pl,elitehealthmedicalcoms.net,email.unibiz.edu.pl,email4.in,emailab.xyz,emailpenting.my.id," +
      "emails.garden,emailxo.pro,epiphanies.app,epmtyfl.me,epuf.name.ng,eqpv.name.ng,eros.email,esscpay.com,eu.arctophilei.com,exolinker.com," +
      "exvp.top,exvpn.top,ezvpn.top,faceb00kmail.com,faircapride.com,faka99.cc,fbmf.zolud.app,fbvby.qqv.me,femboy.foundation,ferrite-core.tech," +
      "floordesignbot.com,fmail.men,freeclaudemythos.cfd,freemail.is,frto.name.ng,fs6.baby,fshare.dpdns.org,funtechme.me,fx-brokers.review,gamene.online," +
      "gay.gayfuckers.com,gcl.matthewer.biz.id,genhz.cc7.name.ng,getnada.email,getnada.net,ggtm.4op.me,ghhj.name.ng,giangtiemruoi.tech,gieaxa.cc20.name.ng,gigabyte.unibiz.edu.pl," +
      "gmail.com,gmailll.bond,gmreeeddd.com,go4vpn.top,godt.suve.me,gomax2025.com,gootsijs.com,granita.me,groundtips.com,gsiz.name.ng," +
      "gtgidhi.com,gtiu.zolud.app,guns.lat,gurame.tech,h4nabi.online,hacktivc.com,hals.greda.app,hanabi.indevs.in,hanabi.qzz.io,happyteethclinic.io.vn," +
      "harvenkiori.com,harynews.com,hateri122.shop,haymail.cyou,heartmula.online,heartpointmedical.com,hegavm.cc19.name.ng,henshou.me,heroclash.info,heromy.indevs.in," +
      "hforz.loks.app,hgoas.cc7.name.ng,hhhcc.online,hhhi.site,hidefrom.us,hidemymail.fr,hiii.site,hnua.zihiv.app,hotkeystech.biz.id,houlaxi.io.vn," +
      "hrmukv.cc20.name.ng,hueandue.io.vn,hust.edu.pl,huy.onlinee.cyou,huyanh05.name.vn,huyendieu.tech,hyikle.cc19.name.ng,i-dont-even-know-the-limit-of-domain-how-long-does-this-goooooo.space,id.edus.edu.pl,id.semar.edu.pl," +
      "ifqvmk.cc15.name.ng,iijj.site,iilu.site,ilyy.org,imissthatkindofmisery.com,in.1maill.com,in.5secmail.com,inbo.email,inboxin.email,infoaboutme.info," +
      "infome.indevs.in,intrarmour.com,inveromail.info,iokvq.bluy.me,iphone17pro.indevs.in,ipiso.tmmad.com,iplv.ovh,iqpill.online,isklex.cc19.name.ng,itzlc.zotet.app," +
      "izcn.name.ng,jaii.shop,jawatengah.net,jawatimur.net,jkb.tmmad.com,jkd.tmmad.com,johnmail.site,just4junk.com,k20pro.indevs.in,kaii.store," +
      "kalimantantimur.net,kapalapi.tech,kdau.bghgp.app,keepdev.me,kent.edus.edu.pl,khaku.indevs.in,khangdino.com,khoviaads.cyou,kimuko12334zzz.shop,kkmail.shop," +
      "kojoball.email,kokomail.cc,kooi.shop,kpl.ovh,kshcid.com,kurmandika.de,kuruptd.ink,kya2.com,kythuatso.fun,kzwh.zihiv.app," +
      "lab.agp.edu.pl,lamenteesmaravillosa.us.com,lanixus.us,lansd.org,layueming.pics,leonard.tattoo,lhadk11.pro,lhte.gvffm.app,lifespringhealth.io.vn,lifetalk.us," +
      "liix.zibon.app,limemail.biz,linkvp.top,linkvpn.top,linqmail.com,liscensekey.io.vn,livebuylocal.com,llnq.org,login.edus.edu.pl,login.securamail.org," +
      "lostsaga.me,lotari.top,lottery-sambad.site,lplso.tmmad.com,luciane.store,luciane.xyz,lumie.indevs.in,lumiere.indevs.in,luvmiumak.xyz,luxury345.com," +
      "lymiddleeast.com,lzyb.bgfrl.app,mail-temp.info,mail-temp.pro,mail-temp.shop,mail.5fa.live,mail.nguyendoll.com,mail.shouyou789.com,mail.toolwiz.id,mailbanvia.com," +
      "mailbanvia.net,mailbavl.com,mailbox.ma,mailcltm.com,maild.site,maildm.net,mailf.site,mailforspams.com,mailhiha.com,mailhihi.com," +
      "mailio.site,mailiot.net,maillive247.bond,mailmmo.eu.cc,mailmmo.io.vn,mailmomy.com,mailn.site,mailp.site,mailregcl.com,mailshield.org," +
      "mailtelig.site,mailuio.com,mailus.app,manikaraza.shop,mariathecuties.indevs.in,marimas.works,mavobox.com,mbmz31.pro,mbox.to,mcxhung.2bd.net," +
      "mcxhung.jo3.org,mcxhung.linkpc.net,mcxhung.lol,mcxhung.nett.to,mcxhung.publicvm.com,mcxhung.run.place,mcxhung.work.gd,mcxhung.zone.id,melorvian.com,membermail.net," +
      "metaimail.com,mialvinkimg.asia,micky.biz.id,mienbacnd.online,miffymail.org,miii.site,minee.space,mingyuekeji.online,mingyueming.click,mingyueming.shop," +
      "mingyukeji.lol,minh1.idhmz.io.vn,minhdeptrai.tech,minhne.me,minhphan.tech,minhphanez.me,minhphanshop.me,mixozia.com,mmo.dpdns.org,mogging.life," +
      "mogging.lol,moifreefire.me,moifreefire.tech,mongchieuxuan.click,montecarlo.pw,mrax.bgfrl.app,mwlp.skin,mxl001.win,mxmm.hair,my.cleantempmail.com," +
      "mychange.blog,myfollow.pics,myinfo.indevs.in,mypass.best,mysummary.shop,naii.fun,nam2002.site,namkhanh61.com,namkhanh61.net,nano-watt.tech," +
      "nbzy.hair,newtonius.net,nfyda.bluy.me,ng.5secmail.com,nghiendesigner.store,nguyenbaoanh94750.click,nguyendoll.com,nian.anhnhan.fun,nivoramail.pro,nnqk.bghgp.app," +
      "nnskid.shop,noemi.co.com,nora.indevs.in,novasmiledentalclinic.io.vn,noviqmail.pro,nrpwu.bluy.me,ntdservice.store,nuoitoi.indevs.in,nuoitoi.online,nutrisari.me," +
      "nutye.bond,obee.info,oeralb.com,office365.biz.id,oije.online,ok.wiki,okadk.pro,okmax2025.com,okymail.site,okyre.com," +
      "olvn.zolud.app,olyanfood.com,omail.asia,omail.store,omgmax2025.com,oneon.site,ongvo.com,onlinee.cyou,oooi.fun,openaidontbanme.jp," +
      "openstudy.edu.pl,oryvomail.pro,otheremail.org,ougoods.com,ourisp.net,paich.art,pehol.com,perimeter-x.com,periole.com,phons.online," +
      "pimail.space,pivot-gear.store,pkmail.site,plimbox.com,plupmail.com,plus.unibiz.edu.pl,pmail.asia,police.pet,prembos.online,priyomail.site," +
      "priyop.top,priyor.biz,priyor.top,priyotv.one,pro1.indevs.in,proid.cloud-ip.cc,promptlibrary.bond,protect.support,protvpn.top,prozonetools.com," +
      "ptruyen.com,purespace.design,pwyqd.enpy.me,quangnguyenmmo.io.vn,quangveo3top1zzz12.shop,quick1vpn.top,quickvp.top,rgzx.tmmad.com,riau.net,riuxi.floy.me," +
      "rome.edus.edu.pl,rqpqmt.cc15.name.ng,rrmail.online,rtx.dekiv.app,rujinews.com,rupni.name.ng,ruuv.zolud.app,rwzo.bhbjm.app,ryzgx.enpy.me,safehouse.quest," +
      "safevp.top,salmonela.me,salz.unibiz.edu.pl,sanpham.bond,sanpham.cyou,sanphamvn.store,sbrd.suve.me,securamail.org,secure.unibiz.edu.pl,semar.edu.pl," +
      "seokey.org,seotop.web.id,seuuo.com,sevril.win,sgmo.top,shieldvp.top,shoptoolhp.site,sisood.com,skiamazing.com,snapinbox.space," +
      "snepsmail.click,soma.edu.pl,sovv.bghgp.app,spamzero.net,spark.christmas,sptech.io.vn,sqau.zibon.app,sqgm.suve.me,sszlamvinhkangzz5zz.shop,stackfl.site," +
      "stelvano.co.uk,student.edus.edu.pl,student.semar.edu.pl,student.unibiz.edu.pl,studentnews.indevs.in,studentx.me,subview.click,sulawesiselatan.net,sumaterabarat.net,sumaterautara.net," +
      "superbee.my,surgerm.com,synapse-core.online,szmyv.zotet.app,t-mail.asia,taifsoft.com,taikhoanpro.tech,taikhoanprovip.tech,taikhoanstore.tech,taikhoanvip.me," +
      "taikhoanvip.tech,tailoredin.com,takeset.shop,taphoatainguyen.cyou,tdkoa.bluy.me,teacher.edus.edu.pl,teacher.semar.edu.pl,teacher.unibiz.edu.pl,teajus.me,teamangel.mom," +
      "teamdev.work.gd,techernews.indevs.in,teliemail.site,tempmail.ai,tempmail.click,tempmail.tokenized.name,tempmailapi.io.vn,tempmailmmo.co.uk,tempmailmmo.com,tempmailonline.co," +
      "tempmails24.com,tempmailt.com,tempmailvip.cyou,temporary-mail.paicha.cloud,temporarymail.fr,temptomail.org,thiencobattu.io.vn,thietke3d.website,throbbingdick.love,timail.site," +
      "tksieure.tech,tksiure.me,tmail.ma,tmre.site,tnmmail.com,tomboy.best,tomboy.live,toolkitmmo.com,toolsmail.me,toplearning.site," +
      "touaxin.com,tplo.top,tpoaw.loks.app,traili-is-a-skid.xyz,trialservices.cloud,tsby.bgyjk.app,tumoroxa.shop,ulmerso.com,umail.asia,un.unibiz.edu.pl," +
      "uncmail.org,unibiz.edu.pl,university.unibiz.edu.pl,unljc.qqv.me,up.agp.edu.pl,upov.zihiv.app,urban-folly.store,usacademy.web.id,usmail.my.id,ussteel.xyz," +
      "uwdo.zolud.app,uwvcuy.cc20.name.ng,valentrixorsystems.co.uk,valentrixorsystems.store,vanish.wtf,velonarix.com,venkat.biz,venkat.pics,vercel.buzz,verify.securamail.org," +
      "vibecodingmmo.com,vietcoder.tokenized.name,villatogel.com,vipcs.store,vllalo.pro,vlog1.top,vlogtop.top,vngzvg.cc19.name.ng,vpaccess.top,vpack.top," +
      "vpass1.top,vpath.top,vpclick1.top,vpfast.top,vpkey.top,vplink.top,vplog1.top,vpn4fast.top,vpnclick.top,vpncon.top," +
      "vpnex.top,vpnhub.top,vpnin.top,vpnkey.top,vpnkey1.top,vpnkeyz.top,vpnlive.top,vpnlock.top,vpnlog.top,vpnmax.top," +
      "vpnow.top,vpnow1.top,vpnpass.top,vpnpath.top,vpnport.top,vpnrocket.top,vpnsafe.top,vpnshort.top,vpnshot.top,vpnsnap.top," +
      "vpnstack.top,vpnsurf.top,vpnto.top,vpnup.top,vpnup1.top,vpnwayz.top,vpnzest.top,vpquick.top,vpquick1.top,vprocket.top," +
      "vpsafe1.top,vpset.top,vpteam.top,vvkku.com,vvv42phongnhan96aaaa.shop,vwh.sh,vzap.top,warmeta.net,waterlemon.indevs.in,watson.lat," +
      "wavetura.co.uk,wawo.zolud.app,wazbox.com,wealthbestway.com,web.securamail.org,webmail.unibiz.edu.pl,wellpointmedical.io.vn,wingmer.com,wnqt.poj.me,wordpressvn.space," +
      "work.unibiz.edu.pl,workspacevn.indevs.in,wvtp.zolud.app,x866.cc,xdanae.com,xhxveh.cc15.name.ng,xmz1.net,xn--80aabqk5atp.com,xnxjdjd.com,xuti.crev.me," +
      "xwdf.zolud.app,yadvt.qqv.me,yamakawateruki.jp,yamakawateruki.net,yaoiland.io.vn,yasdsgar.com,yeahmax2025.com,yilo.zihiv.app,yoyosheeh.online,z4keys.top," +
      "zakumaka.shop,zenthoriqindustries.com,zenthoriqindustries.org,zonkbox.com,zynario.pro,zz51zlamvinhkangzz54zz.shop,zz5zlamvinhanzz5zz.shop,zz9zzz3zzwwwoo.shop,zztokudayukamizzaz123zaza.shop,zzveo3quangtop98.shop," +
      "zzzalamvinhkang44zz.shop,zzzbakana666.shop,zzzi.space,zzzkamicod32azike12.shop,zzzkutaradazatop7.shop,zzzkutaradazatop77.shop,zzzquangveo3top100zz.shop,zzzz544lamsangmaizzzz.shop,zzzzkumazanawwntara123.shop,zzzzquangveo123top2.shop," +
      "zzzkutaradazatop77.shop,zzzquangveo3top100zz.shop,zzzz544lamsangmaizzzz.shop,zzzzkumazanawwntara123.shop,zzzzquangveo123top2.shop,zzzzquangveo36789top5.shop,zzzzukamitokuda12.shop,zzzzzhangphongnizzzz.shop,zzzzzkumuuuu12.shop,zzzzztuananhnamzzzz.shop")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

async function resolveRaccoonIp() {
  if (raccoonIpCache && raccoonIpCache.expiresAt > Date.now())
    return raccoonIpCache;
  for (const family of [4, 6]) {
    try {
      const addrs =
        family === 4
          ? await dns.promises.resolve4(RACCOON_HOST)
          : await dns.promises.resolve6(RACCOON_HOST);
      if (addrs?.length) {
        const ip = addrs[Math.floor(Math.random() * addrs.length)];
        raccoonIpCache = { ip, family, expiresAt: Date.now() + 5 * 60_000 };
        return raccoonIpCache;
      }
    } catch {}
  }
  return null;
}

async function fetchWithTimeout(url, opts = {}, ms = RACCOON_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function raccoonFetch(pathAndQuery, opts = {}) {
  const entry = await resolveRaccoonIp();
  if (!entry)
    return fetchWithTimeout(`https://${RACCOON_HOST}${pathAndQuery}`, opts);
  const authority = entry.family === 6 ? `[${entry.ip}]` : entry.ip;
  try {
    return await fetchWithTimeout(`https://${authority}${pathAndQuery}`, {
      ...opts,
      headers: { ...opts.headers, Host: RACCOON_HOST },
    });
  } catch {
    raccoonIpCache = null;
    return fetchWithTimeout(`https://${RACCOON_HOST}${pathAndQuery}`, opts);
  }
}

const sessions = new Map();
const siteUsage = new Map();
const ipLimits = new Map();
const embedIpLimits = new Map();
const accountCreating = new Map();

const MAX_SESSION_SECONDS = 19 * 60;

function decryptPayload(result) {
  const key = Buffer.from("fd39e724f7c1e4b3d34bc7c72b5349c3", "utf8");
  const iv = Buffer.from("dd39e4a3337fe25a", "utf8");
  const d = createDecipheriv("aes-256-cbc", key, iv);
  const raw = d.update(result, "base64", "utf8") + d.final("utf8");
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object")
    throw new Error("decryptPayload: unexpected shape");
  return parsed;
}

function generateSN() {
  return randomUUID().replace(/-/g, "").toLowerCase();
}

function generatePassword() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$";
  let p = "";
  for (let i = 0; i < 12; i++)
    p += chars[Math.floor(Math.random() * chars.length)];
  return p;
}

// Poll the malq inbox for raccoongame's 6-digit verification code.
// malq returns full message bodies up front (unlike mail.tm), so a single
// GET is enough per check. Providers occasionally 500 on individual polls —
// those are swallowed and retried until the overall deadline expires.
async function getVerificationCode(mailToken) {
  const deadline = Date.now() + VERIFY_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, VERIFY_POLL_INTERVAL_MS));
    try {
      const res = await fetchWithTimeout(
        `${MAIL_HOST}/api/v1/inbox/${encodeURIComponent(mailToken)}`,
        {},
        15_000,
      );
      const data = await res.json();
      for (const msg of (data?.mail || []).slice(0, 20)) {
        const text = [msg?.subject, msg?.body].filter(Boolean).join(" ");
        const match = text.replace(/<[^>]*>/g, "").match(/\b\d{6}\b/);
        if (match) return match[0];
      }
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(
    `Verification code never arrived after ${VERIFY_TIMEOUT_MS / 1000}s` +
      (lastError ? ` — last mailbox error: ${lastError.message}` : ""),
  );
}

// Wait (at boot) for malq to finish initializing its providers.
// malq binds its port only after all provider domains are fetched, so an
// OK response here means it is genuinely ready to hand out inboxes.
async function waitForMalq(maxMs = 180_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetchWithTimeout(`${MAIL_HOST}/`, {}, 3_000);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 3_000));
  }
  return false;
}

const POOL_TARGET = 5;
const pool = [];
let poolFilling = false;

async function fillPool() {
  if (poolFilling) return;
  const needed = POOL_TARGET - pool.length;
  if (needed <= 0) return;
  poolFilling = true;
  try {
    let consecutiveFailures = 0;
    for (let i = 0; i < needed; i++) {
      try {
        const acc = await createAccountRaw();
        pool.push(acc);
        consecutiveFailures = 0;
        logSys(chalk.gray(`pool: ready (${pool.length}/${POOL_TARGET})`));
      } catch (e) {
        consecutiveFailures++;
        logSys(
          chalk.red(`pool: fill error — ${e.message} (${consecutiveFailures})`),
        );
        // One dead mail provider shouldn't stop the pool — malq picks a
        // random provider per session, so the next attempt usually works.
        // Only give up after several consecutive failures.
        if (consecutiveFailures >= 5) break;
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
  } finally {
    poolFilling = false;
  }
}

async function createAccount() {
  if (pool.length > 0) {
    const acc = pool.shift();
    logSys(chalk.gray(`pool: served account (${pool.length} remaining)`));
    fillPool().catch(() => {});
    return acc;
  }
  logSys(chalk.gray("pool: miss — creating account on demand"));
  let acc = null;
  let lastErr = null;
  // Retry with fresh malq sessions — each retry rotates to a different
  // mail provider — before surfacing the error to the caller.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      acc = await createAccountRaw();
      break;
    } catch (e) {
      lastErr = e;
      logSys(chalk.red(`on-demand: attempt ${attempt} failed — ${e.message}`));
    }
  }
  if (!acc) throw lastErr || new Error("Account creation failed");
  fillPool().catch(() => {});
  return acc;
}

async function createAccountRaw() {
  // 1) Ask malq for a disposable inbox. malq picks a random provider per
  //    session (~40 of them) — that rotation is what keeps this resilient
  //    now that raccoongame blocks individual temp-mail domains.
  let sessionRes = await fetchWithTimeout(
    `${MAIL_HOST}/api/v1/session`,
    {},
    15_000,
  );
  let mailSession = await sessionRes.json().catch(() => null);
  let email = mailSession?.address;
  let mailToken = mailSession?.token;
  if (!email || !mailToken) throw new Error("malq returned no session");

  // 1b) raccoon's blocklist keeps growing and malq hands out a RANDOM
  //     provider per session, so many sessions now land on blocked domains
  //     and burn attempts. Resample (up to 8×, 250ms apart) until the
  //     session's domain is on the accepted list; if none of the 8 is, keep
  //     the LAST session anyway — the sendEmail fail-fast below still
  //     rejects newly-blocked domains and the outer retry rotates again.
  for (let tries = 0; tries < 8; tries++) {
    const domain = (email.split("@")[1] || "").toLowerCase();
    if (ACCEPTED_MAIL_DOMAINS.size === 0 || ACCEPTED_MAIL_DOMAINS.has(domain))
      break;
    logSys(
      chalk.gray(
        `mail: ${domain} not on accepted list — resampling (${tries + 1}/8)`,
      ),
    );
    await new Promise((r) => setTimeout(r, 250));
    try {
      sessionRes = await fetchWithTimeout(
        `${MAIL_HOST}/api/v1/session`,
        {},
        15_000,
      );
      mailSession = await sessionRes.json().catch(() => null);
      if (mailSession?.address && mailSession?.token) {
        email = mailSession.address;
        mailToken = mailSession.token;
      }
    } catch {}
  }
  logSys(chalk.gray(`mail: using ${email.split("@")[1] || "?"}`));

  const raccoonPassword = generatePassword();
  const sn = generateSN();

  const h = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/147.0.0.0 Safari/537.36",
  };
  const base = {
    sn,
    model: "Chrome/147.0.0.0",
    version_code: "1",
    version_name: "1.0.0",
    device_name: "我的设备",
    os: "web",
  };

  // 2) Ask raccoongame to send the verification email — and CHECK the
  //    response. raccoongame answers HTTP 200 with
  //    { status: 400, msg: "Temporary email addresses are not supported." }
  //    for blocked domains; failing fast here (instead of waiting ~90s for
  //    a code that never arrives) is what makes provider rotation work.
  const sendRes = await raccoonFetch("/users/sendEmail", {
    method: "POST",
    headers: h,
    body: new URLSearchParams({ email, type: "register", ...base }),
  });
  const sendData = await sendRes.json().catch(() => ({}));
  if (sendData.status !== 200) {
    throw new Error(
      `raccoon rejected ${email.split("@")[1] || "mailbox"}: ${
        sendData.msg || "sendEmail failed"
      }`,
    );
  }

  // 3) Read the 6-digit code out of the malq inbox.
  const code = await getVerificationCode(mailToken);

  await raccoonFetch("/users/emailRegister", {
    method: "POST",
    headers: h,
    body: new URLSearchParams({
      email,
      code,
      password: raccoonPassword,
      phone: "1",
      country: "Brazil",
      ...base,
    }),
  });

  const loginRes = await raccoonFetch("/users/emailLogin", {
    method: "POST",
    headers: h,
    body: new URLSearchParams({ email, password: raccoonPassword, ...base }),
  });
  const loginData = await loginRes.json();
  if (loginData.status !== 200) throw new Error("Login failed");

  let userToken = loginData.data?.user_token || "";
  const cookie = loginRes.headers.get("set-cookie");
  if (cookie) {
    const m = cookie.match(/as_user_token=([^;]+)/);
    if (m) userToken = m[1];
  }

  return { sn, token: userToken };
}

function gameHeaders(token) {
  return {
    accept: "*/*",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    cookie: `as_user_token=${token}`,
    origin: "https://www.raccoongame.com",
    referer: "https://www.raccoongame.com/?t=1720436119",
    "user-agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
    "x-requested-with": "XMLHttpRequest",
  };
}

async function doInitGame(session) {
  const { sn, token, game_key } = session;
  const h = gameHeaders(token);
  const common = {
    sn,
    model: "Chrome/147.0.0.0",
    version_code: "1",
    version_name: "1.0.0",
    device_name: "我的设备",
    os: "web",
    "manufacturer;": "",
    user_token: token,
  };

  // raccoon's edge intermittently drops the connection with a bare
  // "fetch failed"; one quick retry recovers the requesting_game phase
  // instead of killing the whole session.
  const raccoonFetchRetry = async (pathAndQuery, opts) => {
    try {
      return await raccoonFetch(pathAndQuery, opts);
    } catch (e) {
      if (!/fetch failed/i.test(e?.message)) throw e;
      await new Promise((r) => setTimeout(r, 1_500));
      return raccoonFetch(pathAndQuery, opts);
    }
  };

  await raccoonFetchRetry("/userGame/checkCost", {
    method: "POST",
    headers: h,
    body: new URLSearchParams({ ...common, game_key }),
  });

  const playData = await (
    await raccoonFetchRetry("/jyapi/playGame", {
      method: "POST",
      headers: h,
      body: new URLSearchParams({
        ...common,
        game_key,
        model_name: "Chrome/147.0.0.0",
      }),
    })
  ).json();

  if (
    playData.status === 201 ||
    (playData.status === 200 && playData.data?.play_queue_id)
  ) {
    const qid = playData.data?.play_queue_id;
    if (!qid) throw new Error("Missing queue ID");
    return {
      queued: true,
      queue_id: qid,
      initial_pos: playData.data?.queue_pos,
    };
  }
  if (playData.status === 200 && playData.data?.result) {
    const server_data = decryptPayload(playData.data.result);
    return { queued: false, server_data };
  }

  throw new Error(`Unexpected playGame response: ${JSON.stringify(playData)}`);
}

async function doPollQueue(session, queue_id) {
  const { sn, token } = session;
  const d = await (
    await raccoonFetch("/jyapi/playQueue", {
      method: "POST",
      headers: gameHeaders(token),
      body: new URLSearchParams({
        sn,
        model: "Chrome/147.0.0.0",
        version_code: "1",
        version_name: "1.0.0",
        device_name: "我的设备",
        os: "web",
        "manufacturer;": "",
        play_queue_id: queue_id,
        user_token: token,
      }),
    })
  ).json();
  if (d.status !== 200 && d.status !== 201)
    throw new Error(`Queue poll rejected: ${JSON.stringify(d)}`);
  return d.data?.queue_pos ?? 1;
}

async function doClaimGame(session, queue_id) {
  const { sn, token, game_key } = session;
  const d = await (
    await raccoonFetch("/jyapi/playGame", {
      method: "POST",
      headers: gameHeaders(token),
      body: new URLSearchParams({
        sn,
        model: "Chrome/147.0.0.0",
        version_code: "1",
        version_name: "1.0.0",
        device_name: "我的设备",
        os: "web",
        "manufacturer;": "",
        game_key,
        model_name: "Chrome/147.0.0.0",
        play_queue_id: queue_id,
        user_token: token,
      }),
    })
  ).json();
  // raccoon sometimes answers 201 (Created) on a successful claim — any
  // 2xx body status with a result payload is a success, not just 200.
  if (d.status >= 200 && d.status < 300 && d.data?.result)
    return decryptPayload(d.data.result);
  throw new Error(`Failed to claim game. API Status: ${d.status}`);
}

async function doStopGame(session) {
  clearInterval(session.raccoonPingInterval);
  session.raccoonWs?.close();
  if (!session.sc_id) return;
  try {
    await raccoonFetch("/jyapi/stopGame", {
      method: "POST",
      headers: gameHeaders(session.token),
      body: new URLSearchParams({
        sn: session.sn,
        model: "Chrome/147.0.0.0",
        version_code: "1",
        version_name: "1.0.0",
        device_name: "我的设备",
        os: "web",
        "manufacturer;": "",
        sc_id: String(session.sc_id),
        game_type: "1",
        user_token: session.token,
      }),
    });
  } catch {}
}

async function doCost(session) {
  if (!session.sc_id) return;
  try {
    const res = await raccoonFetch("/userGame/cost", {
      method: "POST",
      headers: gameHeaders(session.token),
      body: new URLSearchParams({
        sn: session.sn,
        model: "Chrome/147.0.0.0",
        version_code: "1",
        version_name: "1.0.0",
        device_name: "我的设备",
        os: "web",
        "manufacturer;": "",
        sc_id: String(session.sc_id),
        game_type: "1",
        user_token: session.token,
      }),
    });
    const body = await res.json().catch(() => null);
    logApi(
      session.api_key,
      chalk.gray(`doCost → ${res.status} ${JSON.stringify(body)}`),
    );
    if (body?.status === 3013) {
      killSession(session.uuid, "upstream_terminated");
    }
  } catch (e) {
    logApi(session.api_key, chalk.red(`doCost error: ${e.message}`));
  }
}

function timestamp() {
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
  const date = now.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  });
  return chalk.blackBright(`[${time} ${date}]`);
}

function logApi(apiKey, message) {
  const name = getSiteName(apiKey) || "unknown";
  console.log(`${timestamp()} ${chalk.cyan(name)} ${message}`);
}

function logSys(message) {
  console.log(`${timestamp()} ${chalk.magenta("stratus")} ${message}`);
}

function getClientIp(req) {
  const caddy = req.headers["x-caddy-real-ip-is-here1357908642"];
  if (caddy) return caddy;
  return req.socket.remoteAddress || "unknown";
}

function checkIpLimit(store, ip, windowMs, max) {
  const now = Date.now();
  const hits = (store.get(ip) || []).filter((t) => t > now - windowMs);
  if (hits.length >= max) return false;
  hits.push(now);
  store.set(ip, hits);
  return true;
}

function getSiteName(apiKey) {
  return (
    Object.keys(sites.sites).find((k) => sites.sites[k].api_key === apiKey) ||
    null
  );
}

function getSite(apiKey) {
  const name = getSiteName(apiKey);
  return name ? { name, ...sites.sites[name] } : null;
}

function checkRateLimit(apiKey, site) {
  const now = Date.now();
  const calls = siteUsage.get(apiKey) || [];

  const perMin = calls.filter((t) => t > now - 60_000).length;
  const perHour = calls.filter((t) => t > now - 3_600_000).length;
  const perDay = calls.filter((t) => t > now - 86_400_000).length;
  const perMonth = calls.filter((t) => t > now - 30 * 86_400_000).length;

  if (perMin >= site.limits.per_minute)
    return {
      allowed: false,
      reason: `per-minute limit (${site.limits.per_minute}/min)`,
    };
  if (perHour >= site.limits.per_hour)
    return {
      allowed: false,
      reason: `per-hour limit (${site.limits.per_hour}/hr)`,
    };
  if (perDay >= site.limits.per_day)
    return {
      allowed: false,
      reason: `per-day limit (${site.limits.per_day}/day)`,
    };
  if (perMonth >= site.limits.per_month)
    return {
      allowed: false,
      reason: `per-month limit (${site.limits.per_month}/month)`,
    };

  return { allowed: true };
}

function recordUsage(apiKey) {
  const now = Date.now();
  const calls = (siteUsage.get(apiKey) || []).filter(
    (t) => t > now - 30 * 86_400_000,
  );
  calls.push(now);
  siteUsage.set(apiKey, calls);
}

function getUsageStats(apiKey) {
  const now = Date.now();
  const calls = siteUsage.get(apiKey) || [];
  return {
    perMin: calls.filter((t) => t > now - 60_000).length,
    perHour: calls.filter((t) => t > now - 3_600_000).length,
    perDay: calls.filter((t) => t > now - 86_400_000).length,
    perMonth: calls.filter((t) => t > now - 30 * 86_400_000).length,
  };
}

function countActiveSessions(apiKey) {
  return [...sessions.values()].filter((s) => s.api_key === apiKey).length;
}

function acquireAccountSlot(apiKey, site) {
  const cap = (site.max_concurrent_sessions ?? 5) * 2;
  const current = accountCreating.get(apiKey) ?? 0;
  if (current >= cap) return false;
  accountCreating.set(apiKey, current + 1);
  return true;
}

function releaseAccountSlot(apiKey) {
  const current = accountCreating.get(apiKey) ?? 1;
  const next = current - 1;
  if (next <= 0) accountCreating.delete(apiKey);
  else accountCreating.set(apiKey, next);
}

function applyServerData(session, sd) {
  session.sc_id = sd.sc_id || sd.play_id;
  session.bs_sc_id = sd.bs_sc_id || session.sc_id;
  session.bs_host = sd.bs_host;
  session.bs_token = sd.token;
  session.channel_id = sd.channel_id;
  session.gl_key = sd.gl_key;
  session.play_config = sd.play_config;
  session.turns = sd.turns || [];
  session.message_server = sd.message_server;
}

function killSession(uuid, reason = "unknown") {
  const session = sessions.get(uuid);
  if (!session) return;

  clearTimeout(session.startgame_timeout);
  clearTimeout(session.queue_abandon_timeout);
  clearTimeout(session.ping_timeout);
  clearTimeout(session.session_timeout);
  clearInterval(session.costInterval);

  try {
    session.clientWs?.close(1000, reason);
  } catch {}

  doStopGame(session).catch(() => {});
  sessions.delete(uuid);

  logApi(
    session.api_key,
    chalk.gray(`session ${chalk.white(uuid.slice(0, 8))} killed — ${reason}`),
  );
}

function resetPingTimeout(uuid) {
  const session = sessions.get(uuid);
  if (!session) return;
  clearTimeout(session.ping_timeout);
  session.ping_timeout = setTimeout(
    () => killSession(uuid, "ping_timeout"),
    30_000,
  );
}

const REAPER_DEADLINES = {
  creating: 5 * 60_000,
  finished_queue: 2 * 60_000,
};
const QUEUED_MAX_AGE = 30 * 60_000;
const QUEUED_POLL_STALE_AFTER = 90_000;

setInterval(() => {
  const now = Date.now();
  for (const [uuid, session] of sessions) {
    if (session.state === "queued") {
      const lastSeen = session.last_queue_poll_at ?? session.created_at;
      if (
        now - lastSeen > QUEUED_POLL_STALE_AFTER ||
        now - session.created_at > QUEUED_MAX_AGE
      ) {
        killSession(uuid, "reaper:queued_stale");
      }
      continue;
    }
    const deadline = REAPER_DEADLINES[session.state];
    if (deadline !== undefined && now - session.created_at > deadline) {
      killSession(uuid, `reaper:${session.state}_deadline`);
      continue;
    }
    if (session.state === "active" && !session.session_timeout) {
      killSession(uuid, "reaper:active_no_timeout");
    }
  }
}, 2 * 60_000).unref?.();

function connectRaccoonSignaling(session) {
  const { sn, gl_key, play_config, uuid } = session;

  const raccoonWs = new WebSocket(session.message_server.url);
  session.raccoonWs = raccoonWs;

  const rSend = (p) => {
    if (raccoonWs.readyState === WebSocket.OPEN)
      raccoonWs.send(JSON.stringify(p));
  };
  const toClient = (data) => {
    const cws = session.clientWs;
    if (cws?.readyState === WebSocket.OPEN) {
      cws.send(JSON.stringify(data));
      return;
    }
    // Browser WS not attached yet (raccoon's start_game ack routinely
    // beats the client's connect). Buffer instead of dropping — otherwise
    // game_ready is lost and the embed player hangs on "Connecting".
    session.pendingClientMsgs.push(JSON.stringify(data));
    if (session.pendingClientMsgs.length > 50)
      session.pendingClientMsgs.shift();
  };

  raccoonWs.on("open", () => {
    rSend({
      id: "register",
      type: "webUA",
      uid: sn,
      token: decodeURIComponent(session.message_server.token),
    });
    session.raccoonPingInterval = setInterval(() => {
      rSend({
        id: "ping",
        uid: sn,
        type: "webUA",
        status: "gaming",
        sc_id: session.bs_sc_id,
      });
    }, 30_000);
  });

  raccoonWs.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (data.id) {
      case "register_ack":
        if (data.code === 200) {
          rSend({
            id: "start_game",
            from: sn,
            to: gl_key,
            game_args: "",
            gp_num: 0,
            play_config,
            simpleHandler: null,
            body: {
              force_soft_dec: 0,
              session_id: session.bs_sc_id,
              sn_user_id: sn,
              game_name: null,
              joystick_num: 2,
            },
          });
        }
        break;

      case "start_game":
        if (data.from === gl_key && data.body?.code === 200) {
          toClient({ type: "game_ready" });
        }
        break;

      case "rtc_sdp": {
        const b = data.body;
        if (!b) break;
        try {
          if (b.type === "answer") {
            toClient({ type: "rtc_answer", sdp: b });
          } else if (b.type === "candidate" && b.sdp) {
            toClient({ type: "rtc_candidate", candidate: b.sdp });
          }
        } catch {}
        break;
      }
    }
  });

  raccoonWs.on("close", () => clearInterval(session.raccoonPingInterval));
  raccoonWs.on("error", () =>
    logApi(session.api_key, chalk.red(`signal error on ${uuid.slice(0, 8)}`)),
  );
}

function auth(req, res, next) {
  const apiKey =
    req.headers["x-api-key"] || req.body?.api_key || req.query?.api_key;
  if (!apiKey) return res.status(401).json({ error: "Missing API key." });
  const site = getSite(apiKey);
  if (!site) return res.status(401).json({ error: "Invalid API key." });
  if (!site.enabled)
    return res.status(403).json({ error: "API Key has been disabled." });
  req.site = site;
  req.apiKey = apiKey;
  next();
}

const app = express();

app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  const ip = getClientIp(req);

  if (!checkIpLimit(ipLimits, ip, 60_000, 100)) {
    return res.status(429).json({
      error: "Too many requests from this IP. Try again in a minute.",
    });
  }

  // NOTE: the old req.setTimeout(30_000) killed long-running createSession
  // streams mid-account-creation (the silent ~32s death seen in production).
  // Sessions already have their own guards (reaper deadlines, queue-abandon,
  // ping and max-session timeouts), so the global request timeout is gone.

  next();
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/cloud/v1/embed", (req, res) => {
  if (!req.query.id) {
    return res.status(400).type("text").send("Missing `id` parameter");
  }
  res.sendFile(path.join(__dirname, "public", "e.html"));
});

app.get(
  ["/cloud/v1/embed-data", "/api/cloud/embed-data"],
  function handleEmbedData(req, res) {
    const ip = getClientIp(req);
    if (!checkIpLimit(embedIpLimits, ip, 60_000, 30)) {
      return res.status(429).json({ error: "Too many requests. Slow down." });
    }

    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Missing id." });

    const session = sessions.get(id);
    if (!session)
      return res.status(404).json({ error: "Session not found or expired." });
    if (session.state !== "active")
      return res.status(400).json({ error: "Session not yet active." });

    res.json({
      ice_servers: session.embed_ice_servers,
      signaling_ws: session.embed_signaling_ws,
    });
  },
);

app.post("/cloud/v1/createSession", auth, async (req, res) => {
  const { game_key } = req.body;
  if (!game_key || typeof game_key !== "string" || game_key.length > 256) {
    return res.status(400).json({ error: "Invalid game_key." });
  }

  const { site, apiKey } = req;

  if (countActiveSessions(apiKey) >= site.max_concurrent_sessions) {
    return res.status(429).json({
      error: `Concurrent session limit reached (max ${site.max_concurrent_sessions}).`,
    });
  }

  const rl = checkRateLimit(apiKey, site);
  if (!rl.allowed)
    return res
      .status(429)
      .json({ error: `Rate limit exceeded: ${rl.reason}.` });

  if (!acquireAccountSlot(apiKey, site)) {
    return res
      .status(429)
      .json({ error: "Too many sessions being created. Try again shortly." });
  }

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();

  const push = (obj) => res.write(JSON.stringify(obj) + "\n");
  const uuid = randomUUID();

  const rawLimit = site.max_session_seconds ?? MAX_SESSION_SECONDS;
  const sessionLimit = Math.min(rawLimit, MAX_SESSION_SECONDS);

  const session = {
    uuid,
    api_key: apiKey,
    state: "creating",
    game_key,
    sn: "",
    token: "",
    created_at: Date.now(),
    max_session_seconds: sessionLimit,
    last_queue_poll_at: null,
    last_ping_at: null,
    startgame_timeout: null,
    queue_abandon_timeout: null,
    ping_timeout: null,
    session_timeout: null,
    raccoonWs: null,
    raccoonPingInterval: null,
    clientWs: null,
    pendingClientMsgs: [],
    costInterval: null,
  };
  sessions.set(uuid, session);
  logApi(
    apiKey,
    `${chalk.gray("createSession")} ${chalk.white(game_key)} → ${chalk.white(uuid.slice(0, 8))}`,
  );

  try {
    push({ status: "creating_account" });
    const acc = await createAccount();

    releaseAccountSlot(apiKey);

    if (!sessions.has(uuid)) return res.end();

    session.sn = acc.sn;
    session.token = acc.token;
    recordUsage(apiKey);

    push({ status: "account_ready" });
    push({ status: "requesting_game" });

    const init = await doInitGame(session);

    if (!sessions.has(uuid)) return res.end();

    if (init.queued) {
      session.state = "queued";
      session.queue_id = init.queue_id;

      session.queue_abandon_timeout = setTimeout(
        () => killSession(uuid, "queue_abandoned"),
        60_000,
      );

      push({ status: "queue", uuid, queue_pos: init.initial_pos });
    } else {
      applyServerData(session, init.server_data);
      session.state = "finished_queue";
      session.finished_queue_at = Date.now();

      session.startgame_timeout = setTimeout(
        () => killSession(uuid, "startgame_timeout"),
        30_000,
      );

      push({
        status: "finished_queue",
        uuid,
        fetch_this_within_30s_or_terminate: "/cloud/v1/startGame",
      });
    }
  } catch (e) {
    releaseAccountSlot(apiKey);
    push({ status: "error", error: e.message });
    killSession(uuid, "creation_error");
  }

  res.end();
});

app.get("/cloud/v1/getQueue", auth, async (req, res) => {
  const { uuid } = req.query;
  if (!uuid) return res.status(400).json({ error: "Missing uuid." });

  const session = sessions.get(uuid);
  if (!session)
    return res.status(404).json({ error: "Session not found or expired." });
  if (session.api_key !== req.apiKey)
    return res.status(403).json({ error: "Forbidden." });

  if (session.state !== "queued" && session.state !== "finished_queue") {
    return res
      .status(400)
      .json({ error: `Session is '${session.state}', not pollable.` });
  }

  const now = Date.now();
  if (session.last_queue_poll_at && now - session.last_queue_poll_at < 3_000) {
    return res
      .status(429)
      .json({ error: "Too fast. Poll getQueue at most once every 3 seconds." });
  }
  session.last_queue_poll_at = now;

  clearTimeout(session.queue_abandon_timeout);
  session.queue_abandon_timeout = setTimeout(
    () => killSession(uuid, "queue_abandoned"),
    60_000,
  );

  if (session.state === "finished_queue") {
    return res.json({
      status: "finished_queue",
      uuid,
      fetch_this_within_30s_or_terminate: "/cloud/v1/startGame",
    });
  }

  try {
    const pos = await doPollQueue(session, session.queue_id);

    if (pos === 0) {
      const serverData = await doClaimGame(session, session.queue_id);
      applyServerData(session, serverData);
      session.state = "finished_queue";
      session.finished_queue_at = Date.now();
      clearTimeout(session.queue_abandon_timeout);

      session.startgame_timeout = setTimeout(
        () => killSession(uuid, "startgame_timeout"),
        30_000,
      );

      return res.json({
        status: "finished_queue",
        uuid,
        fetch_this_within_30s_or_terminate: "/cloud/v1/startGame",
      });
    }

    return res.json({ status: "queue", queue_pos: pos });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/cloud/v1/startGame", auth, (req, res) => {
  const { uuid } = req.body;
  if (!uuid) return res.status(400).json({ error: "Missing uuid." });

  const session = sessions.get(uuid);
  if (!session)
    return res.status(404).json({ error: "Session not found or expired." });
  if (session.api_key !== req.apiKey)
    return res.status(403).json({ error: "Forbidden." });
  if (session.state !== "finished_queue") {
    return res
      .status(400)
      .json({ error: `Session is '${session.state}', not ready to start.` });
  }

  clearTimeout(session.startgame_timeout);
  clearTimeout(session.queue_abandon_timeout);

  session.state = "active";
  session.game_started_at = Date.now();

  resetPingTimeout(uuid);

  session.session_timeout = setTimeout(
    () => killSession(uuid, "max_session_length"),
    session.max_session_seconds * 1000,
  );

  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    ...(session.turns || []).map((t) => ({
      urls: t.turn_url,
      username: t.turn_user,
      credential: t.turn_password,
    })),
  ];

  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const signalingWs = `${proto === "https" ? "wss" : "ws"}://${req.headers.host}/cloud/v1/signal/${uuid}`;

  session.embed_ice_servers = iceServers;
  session.embed_signaling_ws = signalingWs;

  session.costInterval = setInterval(() => doCost(session), 25_000);

  res.json({
    ice_servers: iceServers,
    signaling_ws: signalingWs,
    max_seconds: session.max_session_seconds,
  });

  logApi(
    req.apiKey,
    `${chalk.gray("startGame")} ${chalk.white(session.game_key)} → ${chalk.white(uuid.slice(0, 8))}`,
  );

  connectRaccoonSignaling(session);
});

app.post("/cloud/v1/pingSession", auth, (req, res) => {
  const { uuid } = req.body;
  if (!uuid) return res.status(400).json({ error: "Missing uuid." });

  const session = sessions.get(uuid);
  if (!session)
    return res.status(404).json({ error: "Session not found or expired." });
  if (session.api_key !== req.apiKey)
    return res.status(403).json({ error: "Forbidden." });
  if (session.state !== "active")
    return res.status(400).json({ error: "Session is not active." });

  const now = Date.now();
  if (session.last_ping_at && now - session.last_ping_at < 3_000) {
    return res
      .status(429)
      .json({ error: "Too fast. Ping at most once every 3 seconds." });
  }

  session.last_ping_at = now;
  resetPingTimeout(uuid);

  const { site } = req;
  const usage = getUsageStats(req.apiKey);
  const timeUsed = Math.floor((now - session.game_started_at) / 1000);

  res.json({
    session_time_used_seconds: timeUsed,
    session_time_limit_seconds: session.max_session_seconds,
    quota: {
      minute: { used: usage.perMin, limit: site.limits.per_minute },
      hour: { used: usage.perHour, limit: site.limits.per_hour },
      day: { used: usage.perDay, limit: site.limits.per_day },
      month: { used: usage.perMonth, limit: site.limits.per_month },
    },
  });
});

app.post("/cloud/v1/quitSession", auth, (req, res) => {
  const { uuid } = req.body;
  if (!uuid) return res.status(400).json({ error: "Missing uuid." });

  const session = sessions.get(uuid);
  if (!session)
    return res.status(404).json({ error: "Session not found or expired." });
  if (session.api_key !== req.apiKey)
    return res.status(403).json({ error: "Forbidden." });

  logApi(
    req.apiKey,
    `${chalk.gray("quitSession")} ${chalk.white(uuid.slice(0, 8))}`,
  );
  killSession(uuid, "quit_requested");
  res.json({ status: "ok" });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const match = req.url.match(/^\/cloud\/v1\/signal\/([0-9a-f-]{36})$/i);
  if (!match) {
    socket.destroy();
    return;
  }

  const uuid = match[1];
  const session = sessions.get(uuid);

  if (!session || session.state !== "active") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    session.clientWs = ws;

    // Flush anything raccoon pushed before the browser got here
    // (game_ready/rtc_answer/early candidates) — order preserved.
    if (session.pendingClientMsgs && session.pendingClientMsgs.length) {
      for (const buffered of session.pendingClientMsgs) ws.send(buffered);
      session.pendingClientMsgs = [];
    }

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const rws = session.raccoonWs;
      if (!rws || rws.readyState !== WebSocket.OPEN) return;

      if (msg.type === "rtc_offer" && msg.sdp) {
        rws.send(
          JSON.stringify({
            id: "rtc_sdp",
            from: session.sn,
            to: session.gl_key,
            body: { sdp: msg.sdp, type: "offer" },
          }),
        );
      } else if (msg.type === "rtc_candidate" && msg.candidate) {
        // Browsers send RTCIceCandidateInit objects (candidate.toJSON());
        // raccoon's inbound candidates are plain SDP strings.
        const cand =
          typeof msg.candidate === "string"
            ? msg.candidate
            : msg.candidate.candidate || JSON.stringify(msg.candidate);
        rws.send(
          JSON.stringify({
            id: "rtc_sdp",
            from: session.sn,
            to: session.gl_key,
            body: { type: "candidate", sdp: cand },
          }),
        );
      }
    });

    ws.on("close", () => {
      session.clientWs = undefined;
    });
    ws.on("error", () => {});
  });
});

setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [ip, timestamps] of ipLimits.entries()) {
    const recent = timestamps.filter((t) => t > cutoff);
    if (recent.length === 0) ipLimits.delete(ip);
    else ipLimits.set(ip, recent);
  }
  for (const [ip, timestamps] of embedIpLimits.entries()) {
    const recent = timestamps.filter((t) => t > cutoff);
    if (recent.length === 0) embedIpLimits.delete(ip);
    else embedIpLimits.set(ip, recent);
  }
}, 60_000).unref?.();

httpServer.listen(PORT, () => {
  const label = (s) => chalk.dim(s.padStart(12));
  const siteList = Object.entries(sites.sites);

  console.log("");
  console.log(chalk.bold(" 🔌 stratus api"));
  console.log("");
  console.log(label("port") + "  " + chalk.white(PORT));
  console.log(label("sites") + "  " + chalk.white(siteList.length));
  console.log(
    label("cap") +
      "  " +
      chalk.white(`${MAX_SESSION_SECONDS / 60}m max session`),
  );
  console.log(label("pool") + "  " + chalk.white(`${POOL_TARGET} accounts`));
  console.log("");

  siteList.forEach(([name, cfg]) => {
    const sessionCap = Math.min(
      cfg.max_session_seconds ?? MAX_SESSION_SECONDS,
      MAX_SESSION_SECONDS,
    );
    const status = cfg.enabled ? chalk.green("enabled") : chalk.red("disabled");
    console.log(
      `  ${chalk.white(name.padEnd(20))} ${status}  ${chalk.blackBright(`max ${cfg.max_concurrent_sessions} concurrent  ·  ${sessionCap}s limit`)}`,
    );
  });

  console.log("");

  // Don't fill the account pool until malq is up (it needs ~30-60s on a
  // cold boot to initialize all of its mail providers).
  (async () => {
    const ok = await waitForMalq();
    logSys(
      ok
        ? "malq (temp-mail) ready — filling account pool"
        : "malq NOT ready after 3min — accounts will be created on demand",
    );
    fillPool().catch(() => {});
    // Serve-time refills only fire when a session consumes an account, so
    // an idle instance would otherwise stay drained forever. Top the pool
    // back up on a timer too.
    setInterval(() => {
      if (!poolFilling) fillPool();
    }, 60_000).unref?.();
  })();
});
