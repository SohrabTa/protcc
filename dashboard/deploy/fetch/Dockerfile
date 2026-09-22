# The setup container. It puts the data tree in the volume and exits.
#
# Python from the standard library only, so the image needs no package install and no network at
# build time beyond the base image itself.
FROM python:3.12-alpine

WORKDIR /app
COPY fetch_data.py /app/fetch_data.py

# The release file is mounted, not copied, so a new release needs no rebuild of this image.
VOLUME ["/data"]
ENTRYPOINT ["python", "-u", "/app/fetch_data.py"]
