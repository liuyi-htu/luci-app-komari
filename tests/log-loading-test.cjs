'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
class Element {
 constructor(tag,attrs={},children=[]) {
  this.tag=tag;this.attrs=attrs;this.listeners={};this.children=[];
  this.value=attrs.value || '';
  if(attrs.click)this.addEventListener('click',attrs.click);
  for(const child of (Array.isArray(children)?children:[children]))this.appendChild(child);
  if(tag==='select')this.value=this.children[0].value;
 }
 appendChild(child) { this.children.push(child);if(child && typeof child==='object')child.parentNode=this;return child; }
 setAttribute(key,value) { this.attrs[key]=value; }
 addEventListener(key,fn) { this.listeners[key]=fn; }
 querySelector() { return logLink; }
 replaceChildren(...children) { this.children=[];children.forEach(x=>this.appendChild(x)); }
}
const E=(...args)=>new Element(...args), logLink=E('a');
let calls=[],panes;
function widget() { const w={running:false,updateControls(){},refreshStatus:()=>Promise.resolve(),load:()=>Promise.resolve()};w.statusBlock=E('div');w.statusFooter=E('div',{},w.statusBlock);w.render=()=>Promise.resolve(w.statusFooter);return w; }
const source=fs.readFileSync(require('node:path').join(__dirname,'../htdocs/luci-static/resources/view/komari/overview.js'),'utf8');
const view=new Function('view','ui','fs','komariI18n','serverWidget','agentWidget','E','_','document',source)(
 {extend:x=>x},{tabs:{initTabGroup:x=>{panes=x;}},addNotification(){}},
 {exec:async(helper,args)=>{calls.push(args);return {code:0,stdout:'message\n'};}},
 {logText:x=>x,translate:x=>x},widget(),widget(),E,x=>x,{getElementById:()=>null});
(async()=>{
 await view.render(await view.load());
 assert.deepEqual(panes.map(p=>p.attrs['data-tab']),['agent','server','log','update']);
 assert.equal(panes[0].attrs['data-tab-active'],'true');
 assert.notEqual(panes[1].attrs['data-tab-active'],'true');
 const logPane=panes[2],panel=logPane.children[0];
 if(logPane.listeners['cbi-tab-active'])await logPane.listeners['cbi-tab-active']();
 assert.equal(calls.length,0,'Initial tab initialization must not read logs');
 await logLink.listeners.click();
 assert.deepEqual(calls,[['read-log','komari']]);
 await logLink.listeners.click();assert.equal(calls.length,2,'Clicking the active log tab refreshes');
 const select=panel.children[0].children[0];select.value='agent.log';
 await select.listeners.change();assert.deepEqual(calls[2],['read-log','komari-agent']);
 console.log('No initial log read; explicit log clicks and file changes load logs passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
