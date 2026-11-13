package com.qfirst.replay;

import java.nio.file.*;
import java.sql.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;
import static com.qfirst.replay.ReplayService.*;

/** Single-board MVP store. A session lock prevents two Spring replicas from owning mutable replay state. */
@Component
final class ReplayStore implements AutoCloseable {
    private final String url,user,password;
    private final JsonMapper json=JsonMapper.builder().findAndAddModules().build();
    private final Connection owner;
    ReplayStore(@Value("${qfirst.db.url}") String url,@Value("${qfirst.db.user}") String user,
                @Value("${qfirst.db.password}") String password) throws Exception {
        this.url=url;this.user=user;this.password=password;
        owner=connect();
        try(var st=owner.createStatement()) {
            var rs=st.executeQuery("SELECT pg_try_advisory_lock(71423001)");rs.next();
            if(!rs.getBoolean(1)) throw new IllegalStateException("Another Spring replay owner is running");
            st.execute("CREATE TABLE IF NOT EXISTS replay_state(id int PRIMARY KEY CHECK(id=1), payload jsonb NOT NULL)");
            st.execute("CREATE TABLE IF NOT EXISTS source_files(name text PRIMARY KEY, sha256 text NOT NULL, content text NOT NULL)");
            st.execute("CREATE TABLE IF NOT EXISTS judgment_versions(run_id text, incident_id text, revision int, payload jsonb NOT NULL, PRIMARY KEY(run_id,incident_id,revision))");
            st.execute("CREATE TABLE IF NOT EXISTS investigation_jobs(id text PRIMARY KEY, request jsonb NOT NULL, status text NOT NULL DEFAULT 'queued', attempts int NOT NULL DEFAULT 0, token uuid, lease_until timestamptz, available_at timestamptz NOT NULL DEFAULT now(), result jsonb, failure_code text, created_at timestamptz NOT NULL DEFAULT now())");
            st.execute("CREATE INDEX IF NOT EXISTS investigation_jobs_pending ON investigation_jobs(status,available_at)");
        } catch(Exception e) { owner.close(); throw e; }
    }
    Connection connect() throws SQLException { return DriverManager.getConnection(url,user,password); }
    private void checkOwner() throws SQLException {
        if(!owner.isValid(2)) throw new IllegalStateException("Replay ownership connection lost; restart required");
    }
    void verifyDataset(Path path) {
        try(var c=connect();var files=Files.list(path)) {
            c.setAutoCommit(false);
            var paths=files.filter(f->f.toString().endsWith(".csv")).sorted().toList();
            Set<String> names=new HashSet<>();
            for(var f:paths) {
                String name=f.getFileName().toString();names.add(name);
                byte[] bytes=Files.readAllBytes(f);
                String hash=HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));
                try(var st=c.prepareStatement("SELECT sha256 FROM source_files WHERE name=?")) {
                    st.setString(1,name);var rs=st.executeQuery();
                    if(rs.next()&&!hash.equals(rs.getString(1))) throw new IllegalStateException("Dataset changed; use a new database: "+name);
                }
                try(var st=c.prepareStatement("INSERT INTO source_files VALUES(?,?,?) ON CONFLICT DO NOTHING")) {
                    st.setString(1,name);st.setString(2,hash);st.setString(3,new String(bytes,java.nio.charset.StandardCharsets.UTF_8));st.executeUpdate();
                }
            }
            try(var st=c.createStatement();var rs=st.executeQuery("SELECT name FROM source_files")) {
                while(rs.next()) if(!names.contains(rs.getString(1))) throw new IllegalStateException("Dataset file missing");
            }
            if(names.isEmpty()) throw new IllegalStateException("No dataset CSV files");
            c.commit();
        } catch(Exception e) { throw new IllegalStateException("Cannot verify source snapshot",e); }
    }
    Checkpoint copy(Checkpoint state) { return json.readValue(json.writeValueAsString(state),Checkpoint.class); }
    Checkpoint load() {
        try(var c=connect();var st=c.createStatement();var rs=st.executeQuery("SELECT payload::text FROM replay_state WHERE id=1")) {
            return rs.next()?json.readValue(rs.getString(1),Checkpoint.class):null;
        } catch(Exception e) {throw new IllegalStateException("Checkpoint read failed",e);}
    }
    void save(Checkpoint state) {
        try(var c=connect()) {
            checkOwner();c.setAutoCommit(false);
            try(var st=c.prepareStatement("INSERT INTO replay_state VALUES(1,?::jsonb) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload")) {
                st.setString(1,json.writeValueAsString(state));st.executeUpdate();
            }
            for(var entry:state.history().entrySet()) for(var detail:entry.getValue()) {
                try(var st=c.prepareStatement("INSERT INTO judgment_versions VALUES(?,?,?,?::jsonb) ON CONFLICT DO NOTHING")) {
                    st.setString(1,state.runId());st.setString(2,entry.getKey());st.setInt(3,detail.judgment().revision());
                    st.setString(4,json.writeValueAsString(detail));st.executeUpdate();
                }
            }
            for(var job:state.investigations().values()) {
                try(var st=c.prepareStatement("INSERT INTO investigation_jobs(id,request) VALUES(?,?::jsonb) ON CONFLICT DO NOTHING")) {
                    st.setString(1,job.request().id());st.setString(2,json.writeValueAsString(job.request()));st.executeUpdate();
                }
            }
            c.commit();
        } catch(Exception e) {throw new IllegalStateException("Checkpoint/queue transaction failed",e);}
    }
    record Claimed(AgentGateway.InvestigationRequest request, UUID token) {}
    Claimed claim() {
        try(var c=connect()) {
            c.setAutoCommit(false);
            try(var st=c.createStatement()) {
                st.executeUpdate("UPDATE investigation_jobs SET status='failed',failure_code='RETRY_EXHAUSTED' WHERE status='running' AND lease_until<now() AND attempts>=3");
            }
            try(var st=c.createStatement();var rs=st.executeQuery("SELECT id,request::text FROM investigation_jobs WHERE attempts<3 AND ((status='queued' AND available_at<=now()) OR (status='running' AND lease_until<now())) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1")) {
                if(!rs.next()) {c.commit();return null;}
                String id=rs.getString(1);var req=json.readValue(rs.getString(2),AgentGateway.InvestigationRequest.class);
                UUID token=UUID.randomUUID();
                try(var up=c.prepareStatement("UPDATE investigation_jobs SET status='running',attempts=attempts+1,token=?,lease_until=now()+interval '210 seconds' WHERE id=?")) {
                    up.setObject(1,token);up.setString(2,id);up.executeUpdate();
                }
                c.commit();return new Claimed(req,token);
            }
        } catch(Exception e) {throw new IllegalStateException("Job claim failed",e);}
    }
    boolean finish(Claimed job,AgentGateway.Result result,String failure,boolean retryable) {
        try(var c=connect();var st=c.prepareStatement("UPDATE investigation_jobs SET status=CASE WHEN ? THEN 'completed' WHEN ? AND attempts<3 THEN 'queued' ELSE 'failed' END, result=?::jsonb, failure_code=?,available_at=now()+interval '5 seconds',lease_until=NULL WHERE id=? AND token=? AND status='running' AND lease_until>now()")) {
            st.setBoolean(1,result!=null);st.setBoolean(2,retryable);st.setString(3,result==null?null:json.writeValueAsString(result));
            st.setString(4,failure);st.setString(5,job.request().id());st.setObject(6,job.token());return st.executeUpdate()==1;
        } catch(Exception e) {throw new IllegalStateException("Job completion failed",e);}
    }
    AgentGateway.Job job(String id) {
        try(var c=connect();var st=c.prepareStatement("SELECT status,result::text,failure_code FROM investigation_jobs WHERE id=?")) {
            st.setString(1,id);var rs=st.executeQuery();if(!rs.next())return null;
            String status=rs.getString(1);String result=rs.getString(2);
            return new AgentGateway.Job(id,Set.of("queued","running").contains(status)?"running":status,
                rs.getString(3),result==null?null:json.readValue(result,AgentGateway.Result.class));
        } catch(Exception e) {throw new IllegalStateException("Job read failed",e);}
    }
    @Override public void close() throws SQLException {owner.close();}
}
