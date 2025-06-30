FROM nginx:1.27-alpine

# absolute paths ↓↓↓
RUN rm -rf /usr/share/nginx/html/*
COPY . /usr/share/nginx/html/
RUN chmod -R a+rX /usr/share/nginx/html/model 
RUN find /usr/share/nginx/html -type f -exec chmod 644 {} \;
EXPOSE 13510 80

CMD ["nginx", "-g", "daemon off;"]