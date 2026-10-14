'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/komari/server.js'), 'utf8');
let output = '0\t0\t1.5.1', commands = [], config = {listen_host:'0.0.0.0',listen_port:'25774'};
const anchor = {parentNode:{}}, service = {dataset:{}};
const L = {hasViewPermission: () => true, resolveDefault: (p, d) => p.catch(() => d)};
const doc = {querySelectorAll: () => [], getElementById: id => id === 'komari-panel-link' ? anchor : id === 'komari-service-toggle' ? service : null};
const members = new Function('baseclass','form','uci','fs','ui','poll','komariI18n','L','document','window','_', source)(
 {extend:x=>x}, {}, {get:(c,s,k)=>config[k]},
 {exec:async(helper,args)=>{commands.push([helper,args]);return {code:0,stdout:output};}}, {}, {},
 {translate:x=>x}, L, doc, {location:{hostname:'192.168.1.1'}}, x=>x);
(async()=>{
 members.running=false; members.updatePanelLink(); assert.equal(anchor.parentNode.hidden,true); members.running=true; members.updatePanelLink(); assert.equal(anchor.parentNode.hidden,false); assert.equal(anchor.href,'http://192.168.1.1:25774/');
 config.listen_host='2001:db8::1'; members.updatePanelLink(); assert.equal(anchor.href,'http://[2001:db8::1]:25774/');
 await members.assertStopped(); assert.equal(commands[0][0],'/usr/libexec/komari-read');
 output='1\t0\t1.5.1'; await assert.rejects(members.assertStopped(),/running/);
 members.running=false; members.statusKnown=true; members.updateBusy=true; members.updateControls(); assert.equal(service.disabled,true);
 members.updateBusy=false; members.formReadonly=true; members.updateControls(); assert.equal(service.disabled,true);

 const agentSource = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/komari/agent.js'), 'utf8');
 let agentOutput = '0\t0\t1.5.11', agentCommands = [];
 const agentDoc = {querySelectorAll:()=>[],getElementById:id=>id==='komariAgent-service-toggle'?service:null};
 const agent = new Function('baseclass','form','uci','fs','ui','poll','komariAgentI18n','L','document','window','_',agentSource)(
  {extend:x=>x},{},{}, {exec:async(helper,args)=>{agentCommands.push([helper,args]);return {code:0,stdout:agentOutput};}}, {}, {}, {translate:x=>x}, L, agentDoc, {}, x=>x);
 await agent.assertStopped(); assert.equal(agentCommands[0][0],'/usr/libexec/komari-agent-read');
 assert.equal(agent.running,false); // Server and Agent state belong to separate views.
 agentOutput='1\t0\t1.5.11'; await assert.rejects(agent.assertStopped(),/running/);
 agent.running=false;agent.statusKnown=true;agent.updateBusy=true;agent.updateControls();assert.equal(service.disabled,true);
 for (const text of [source, agentSource]) {
  let modal, hidden=0, reloaded=0;
  const E=(tag,attrs,children)=>({tag,attrs,children});
  const testMembers=new Function('baseclass','ui','window','_','E',text.replace('return baseclass.extend({','return baseclass.extend({showMessage:showMessage,'))(
   {extend:x=>x},{showModal:(title,nodes)=>{modal=nodes;},hideModal:()=>{hidden++;}}, {location:{reload:()=>{reloaded++;}}},x=>x,E);
  testMembers.showMessage('notice',false);
  modal[1].children[0].attrs.click();
  assert.equal(hidden,1); assert.equal(reloaded,0);
 }
 console.log('Server/Agent status separation, update controls and dashboard URLs passed');

})().catch(e=>{console.error(e);process.exitCode=1;});
