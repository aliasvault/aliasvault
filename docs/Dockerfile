# Serve a pre-built Docusaurus static site with nginx.
#
# To build locally first: `npm ci && npm run build`, then `docker compose up --build`.
FROM nginx:alpine
COPY build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
