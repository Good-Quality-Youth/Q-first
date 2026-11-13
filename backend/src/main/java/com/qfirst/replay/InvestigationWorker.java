package com.qfirst.replay;

import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.client.RestClientResponseException;

/** One concurrent investigation for local Ollama; scheduling never blocks board refresh. */
@Component
final class InvestigationWorker implements AutoCloseable {
    private final ReplayStore store;
    private final AgentGateway agent;
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy=new AtomicBoolean();
    private final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(getClass());
    InvestigationWorker(ReplayStore store,AgentGateway agent) {this.store=store;this.agent=agent;}
    @Scheduled(fixedDelay=1000)
    void tick() {
        if(!busy.compareAndSet(false,true))return;
        executor.submit(()->{
            try {
                var job=store.claim();if(job==null)return;
                try { store.finish(job,agent.run(job.request()),null,false); }
                catch(RestClientResponseException ex) {
                    boolean retry=ex.getStatusCode().is5xxServerError();
                    store.finish(job,null,retry?"SERVICE_UNAVAILABLE":"INVALID_RESULT",retry);
                } catch(Exception ex) {store.finish(job,null,"SERVICE_UNAVAILABLE",true);}
            } catch(Exception ex) {log.warn("Investigation worker unavailable: {}",ex.getClass().getSimpleName());}
            finally {busy.set(false);}
        });
    }
    @Override public void close() {executor.shutdownNow();}
}
