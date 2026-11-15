package app.overman.sleep.health;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** In-memory bounded page collector. Partial results are never exposed as complete. */
public final class HealthPageCollector<T> {
    private static final int MAX_PAGES=10,MAX_RECORDS=1000;
    private final List<T> records=new ArrayList<>();
    private final Set<Long> seenTokens=new HashSet<>();
    private int pages;
    private boolean complete,failed;
    private long nextToken=-1;

    public void addPage(List<T> page,long next) {
        if(failed||complete)throw new IllegalStateException("Collector closed");
        if(page==null||page.stream().anyMatch(java.util.Objects::isNull)||pages>=MAX_PAGES||page.size()>MAX_RECORDS-records.size()||next < -1 || (next!=-1&&!seenTokens.add(next))) {
            failed=true;records.clear();throw new IllegalArgumentException("Invalid or excessive Health Connect pages");
        }
        pages++;records.addAll(page);nextToken=next;complete=next==-1;
    }
    public boolean isComplete(){return complete&&!failed;}
    public long nextPageToken(){if(failed||complete||pages==0)throw new IllegalStateException("No next page");return nextToken;}
    public List<T> result(){if(!isComplete())throw new IllegalStateException("Incomplete Health Connect response");return List.copyOf(records);}
}