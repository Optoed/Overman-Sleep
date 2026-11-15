FROM golang:1.26-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -o /overman-api ./cmd/overman

FROM scratch
LABEL app.overman.role="api-image"
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /overman-api /overman-api
USER 65532:65532
ENTRYPOINT ["/overman-api"]
