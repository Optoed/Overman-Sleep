import {execFileSync} from 'node:child_process';
import {readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const runtime=resolve('.tools/jdk',readdirSync('.tools/jdk',{withFileTypes:true}).find(d=>d.isDirectory()).name),classes=resolve('.tools/02.03-policy-classes');mkdirSync(classes,{recursive:true});
execFileSync(resolve(runtime,'bin/javac.exe'),['-d',classes,'android/app/src/main/java/app/overman/sleep/AlarmSoundPolicy.java','android/tests/AlarmSoundPolicyCheck.java'],{stdio:'pipe'});
const output=execFileSync(resolve(runtime,'bin/java.exe'),['-cp',classes,'app.overman.sleep.AlarmSoundPolicyCheck'],{encoding:'utf8'});
if(!output.startsWith('13 Java sound-policy boundary cases passed'))throw Error(output);
writeFileSync('docs/product-evidence/02.03-java-policy.json',JSON.stringify({verifiedAt:new Date().toISOString(),result:'passed',cases:13,output,fixture:'Pure Java production policy executed directly, including system volume zero, no vibration hardware, disabled alarm and invalid gain. No Android context or physical output is mocked or claimed here.'},null,2));console.log(output.trim());
