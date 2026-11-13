package com.qfirst.replay;

import java.sql.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="QFIRST_TEST_DB_URL", matches=".*_test")
class ReplayStoreTest {
    ReplayStore store;
    String url=System.getenv("QFIRST_TEST_DB_URL");
    @BeforeEach void setup() throws Exception {
        try(var c=DriverManager.getConnection(url,"qfirst","qfirst-local-only");var s=c.createStatement()) {
            s.execute("DROP TABLE IF EXISTS investigation_jobs,judgment_versions,replay_state,source_files");
        }
        store=new ReplayStore(url,"qfirst","qfirst-local-only");
    }
    @AfterEach void close() throws Exception {store.close();}
    void sql(String query) throws Exception {try(var c=store.connect();var s=c.createStatement()){s.execute(query);}}
    AgentGateway.InvestigationRequest request() {return new AgentGateway.InvestigationRequest("job-1","incident-1","EQP-003","newWarning",Instant.parse("2026-02-03T05:00:00Z"),Instant.parse("2026-02-03T04:43:00Z"),1,"temperature_celsius");}
    void seed() {
        var j=new ReplayService.InvestigationJob(request(),"running",null,null,0);
        store.save(new ReplayService.Checkpoint("run-1",1,7,null,null,Map.of("incident-1",j),List.of(),Map.of(),Map.of()));
    }
    @Test void duplicateRegistrationAndRestartKeepOneJob() throws Exception {
        seed();seed();var claim=store.claim();assertNotNull(claim);assertNull(store.claim());
        store.close();store=new ReplayStore(url,"qfirst","qfirst-local-only");
        assertEquals(7,store.load().snapshotVersion());assertEquals("running",store.job("job-1").status());
        assertNull(store.claim());
    }
    @Test void expiredLeaseRejectsOldCompletion() throws Exception {
        seed();var first=store.claim();sql("UPDATE investigation_jobs SET lease_until=now()-interval '1 second'");
        var second=store.claim();assertNotEquals(first.token(),second.token());
        assertFalse(store.finish(first,null,"STALE",false));
        assertTrue(store.finish(second,null,"INVALID_RESULT",false));
        assertEquals("INVALID_RESULT",store.job("job-1").failureCode());
    }
    @Test void retriesAreBounded() throws Exception {
        seed();
        for(int i=0;i<3;i++) {
            var claim=store.claim();assertNotNull(claim);store.finish(claim,null,"SERVICE_UNAVAILABLE",true);
            sql("UPDATE investigation_jobs SET available_at=now()-interval '1 second'");
        }
        assertEquals("failed",store.job("job-1").status());assertNull(store.claim());
    }
    @Test void queueFailureRollsBackCheckpoint() throws Exception {
        seed();sql("ALTER TABLE investigation_jobs ADD CONSTRAINT test_reject CHECK(id<>'job-2')");
        var r=request();var other=new AgentGateway.InvestigationRequest("job-2",r.incidentId(),r.equipmentId(),r.trigger(),r.asOf(),r.detectedAt(),1,r.topSensor());
        var j=new ReplayService.InvestigationJob(other,"running",null,null,0);
        assertThrows(IllegalStateException.class,()->store.save(new ReplayService.Checkpoint("run-1",2,8,null,null,Map.of("incident-1",j),List.of(),Map.of(),Map.of())));
        assertEquals(7,store.load().snapshotVersion());assertNull(store.job("job-2"));
    }
    @Test void secondSpringOwnerIsRejected() {
        assertThrows(IllegalStateException.class,()->new ReplayStore(url,"qfirst","qfirst-local-only"));
    }
}
