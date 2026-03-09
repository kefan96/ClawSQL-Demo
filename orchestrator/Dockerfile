# Build Orchestrator v3.2.6 from source
FROM golang:1.21-alpine AS builder

RUN apk add --no-cache git

WORKDIR /src
RUN git clone --depth 1 --branch v3.2.6 https://github.com/openark/orchestrator.git .

WORKDIR /src/go
RUN go mod tidy
RUN go build -mod=mod -o /orchestrator ./cmd/orchestrator

# Runtime image
FROM alpine:3.19

RUN apk add --no-cache mysql-client

COPY --from=builder /orchestrator /usr/local/orchestrator/orchestrator
COPY --from=builder /src/resources /usr/local/orchestrator/resources

RUN mkdir -p /etc /var/log/orchestrator

EXPOSE 3000

ENTRYPOINT ["/usr/local/orchestrator/orchestrator"]
CMD ["--config", "/etc/orchestrator.conf.json", "http"]
