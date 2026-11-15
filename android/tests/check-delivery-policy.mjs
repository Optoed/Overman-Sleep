import {execFileSync} from 'node:child_process';
import {readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const runtime=resolve('.tools/jdk',readdirSync('.tools/jdk',{withFileTypes:true}).find(d=>d.isDirectory()).name),classes=resolve('.tools/02.04-policy-classes');mkdirSync(classes,{recursive:true});
execFileSync(resolve(runtime,'bin/javac.exe'),['-d',classes,'android/app/src/main/java/app/overman/sleep/AlarmDeliveryPolicy.java','android/tests/AlarmDeliveryPolicyCheck.java']);
const output=execFileSync(resolve(runtime,'bin/java.exe'),['-cp',classes,'app.overman.sleep.AlarmDeliveryPolicyCheck'],{encoding:'utf8'});
if(!output.startsWith('9 delivery policy cases passed'))throw Error(output);
writeFileSync('docs/product-evidence/02.04-java-policy.json',JSON.stringify({verifiedAt:new Date().toISOString(),result:'passed',cases:9,output,fixture:'Direct production Java delivery decisions; real Android receiver and output checked separately.'},null,2));console.log(output.trim());
