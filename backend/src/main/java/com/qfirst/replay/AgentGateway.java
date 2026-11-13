package com.qfirst.replay;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import static com.qfirst.replay.ReplayService.*;

@Component
final class AgentGateway {
    private final RestClient client;
    AgentGateway(@Value("${qfirst.agent.url:http://127.0.0.1:18094}") String url) {
        var uri=java.net.URI.create(url);
        if (!List.of("127.0.0.1", "localhost", "[::1]", "agent").contains(uri.getHost()))
            throw new IllegalArgumentException("Local agent URL required");
        var factory=new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(2)); factory.setReadTimeout(Duration.ofSeconds(180));
        client=RestClient.builder().baseUrl(url).requestFactory(factory).build();
    }
    record Detected(String id, String equipmentId, Instant detectedAt, Instant firstWarningAt,
                    Instant alarmAt, String topSensor, double score, int risk, double detectionScore,
                    List<String> evidenceRecordIds) {}
    record Score(String equipmentId, String recordId, double score, int risk, String topSensor, int streak) {}
    record ConfirmationPolicy(int windowSamples, int minimumDeviations, double historyRobustZ, double currentRobustZ) {}
    record Detection(Instant asOf, String profileVersion, double threshold, int consecutive,
                     ConfirmationPolicy confirmationPolicy,
                     List<Detected> events, List<Score> assessments) {}
    record InvestigationRequest(String id, String incidentId, String equipmentId, String trigger,
                                Instant asOf, Instant detectedAt, int judgmentRevision, String topSensor) {}
    record Result(String id, String incidentId, Instant asOf, String model, List<Check> checklist,
                  List<Evidence> evidence, List<Map<String,Object>> trace) {}
    record Job(String id, String status, String failureCode, Result result) {}
    Detection detect(Instant at) {
        return client.post().uri("/detect").body(Map.of("asOf",at.toString(),"sessionStart",ReplayData.clock("13:00").toString()))
                .retrieve().body(Detection.class);
    }
    Result run(InvestigationRequest request) { return client.post().uri("/investigations/run").body(request).retrieve().body(Result.class); }
    void submit(InvestigationRequest request) { client.post().uri("/investigations").body(request).retrieve().toBodilessEntity(); }
    Job job(String id) { return client.get().uri("/investigations/{id}",id).retrieve().body(Job.class); }
}
