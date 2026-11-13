FROM alpine:latest
RUN apk add --no-cache ca-certificates tzdata
ENV TZ=Asia/Ho_Chi_Minh
COPY pocketbase /pb/pocketbase
RUN chmod +x /pb/pocketbase
EXPOSE 8080
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8080"]
