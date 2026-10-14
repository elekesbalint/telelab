FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ ./cmd/...

FROM alpine:3.20
RUN adduser -D -H -u 10001 telelab && mkdir -p /data/recordings && chown telelab /data/recordings
COPY --from=build /out/ /usr/local/bin/
USER telelab
EXPOSE 31600/udp
ENTRYPOINT ["telelab-ingest"]
CMD ["-addr", ":31600", "-record", "/data/recordings"]
