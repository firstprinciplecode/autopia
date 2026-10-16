FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY images /usr/share/nginx/html/images
COPY assets /usr/share/nginx/html/assets
COPY appcast.xml /usr/share/nginx/html/appcast.xml
COPY CreaturesInc.zip /usr/share/nginx/html/CreaturesInc.zip
EXPOSE 80
