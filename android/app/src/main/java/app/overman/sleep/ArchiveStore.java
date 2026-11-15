package app.overman.sleep;

import android.content.Context;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import org.json.JSONObject;

/** AtomicFile fsync completes before JS may announce success or remove wake backup. */
final class ArchiveStore {
    static final int MAX_CHARS=3000000;
    static File path(Context c,String key){
        String name="overman.sleep-tower.v1".equals(key)?"sleep-archive.json":"overman.sleep-tower.v1.before-import".equals(key)?"sleep-before-import.json":"overman.sleep-tower.v1.form-drafts".equals(key)?"sleep-form-drafts.json":null;
        if(name==null)throw new IllegalArgumentException("Неизвестное хранилище дневника.");
        return new File(c.getFilesDir(),name);
    }
    static synchronized String read(Context c,String key) throws IOException {
        File base=path(c,key);if(!base.exists()&&!new File(base.getPath()+".bak").exists())return null;
        AtomicFile file=new AtomicFile(base);
        try(InputStream in=file.openRead();ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
            byte[] block=new byte[8192];int count;while((count=in.read(block))!=-1){if(bytes.size()+count>MAX_CHARS*4)throw new IOException("Дневник слишком большой. Исходный файл не изменён.");bytes.write(block,0,count);}
            return bytes.toString(StandardCharsets.UTF_8.name());
        }
    }
    static synchronized void write(Context c,String key,String expected,String raw) throws Exception {
        if(raw==null||raw.length()>MAX_CHARS)throw new IOException("Дневник превышает допустимый размер. Предыдущая запись сохранена.");
        if(!Objects.equals(read(c,key),expected))throw new IOException("Записи изменились в другом окне. Обнови приложение перед сохранением.");
        if("overman.sleep-tower.v1".equals(key)){
            JSONObject state=new JSONObject(raw);
            if(state.getInt("version")!=1||state.getDouble("revision")!=state.getLong("revision")||state.getLong("revision")<0||!state.has("nights")||!state.has("world"))throw new IOException("Неверный формат дневника.");
        }
        if("overman.sleep-tower.v1.form-drafts".equals(key)){
            try{JSONObject book=new JSONObject(raw);org.json.JSONArray entries=book.getJSONArray("entries");if(raw.length()>1000000||book.getInt("version")!=1||book.getLong("revision")<0||book.getDouble("revision")!=book.getLong("revision")||entries.length()>50)throw new Exception();
                java.util.HashSet<String> ids=new java.util.HashSet<>();for(int i=0;i<entries.length();i++){JSONObject entry=entries.getJSONObject(i),fields=entry.getJSONObject("fields");String mode=entry.getString("mode"),date=entry.getString("date");if(!("manual".equals(mode)||"edit".equals(mode))||!date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")||!ids.add(mode+":"+date)||fields.getString("note").length()>2000||fields.getDouble("rested")!=fields.getInt("rested")||fields.getInt("rested")<0||fields.getInt("rested")>5||!entry.has("offsets")||("edit".equals(mode)&&entry.getString("base").length()>12000)||("manual".equals(mode)&&!entry.isNull("base")))throw new Exception();for(String field:new String[]{"bed","wake","sleep","latency","awake"})if(fields.getString(field).length()>64)throw new Exception();}
            }catch(Exception ignored){throw new IOException("Не удалось сохранить личный черновик. Проверь длину полей.");}
        }
        AtomicFile file=new AtomicFile(path(c,key));FileOutputStream out=null;
        try{out=file.startWrite();out.write(raw.getBytes(StandardCharsets.UTF_8));out.flush();out.getFD().sync();file.finishWrite(out);out=null;if(!raw.equals(read(c,key)))throw new IOException("Запись дневника не подтверждена.");}
        catch(Exception error){if(out!=null)file.failWrite(out);throw new IOException("Не удалось записать дневник Android. Освободи место и повтори. Предыдущая запись сохранена.",error);}
    }
}
