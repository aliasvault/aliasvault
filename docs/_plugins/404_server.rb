require 'webrick'

module Jekyll
  class FourOhFourPage < StaticFile
    def write(dest)
      true
    end
  end

  class FourOhFourGenerator < Generator
    priority :low

    def generate(site)
      site.static_files << FourOhFourPage.new(site, site.dest, '/', '404.html')
    end
  end
end

# Override WEBrick to serve 404.html for missing files
if defined?(WEBrick)
  module WEBrick
    class HTTPServlet::FileHandler
      alias_method :do_GET_original, :do_GET

      def do_GET(req, res)
        do_GET_original(req, res)
      rescue HTTPStatus::NotFound => ex
        return_404_page(req, res)
      rescue => ex
        raise ex
      end

      def return_404_page(req, res)
        path = File.join(@config[:DocumentRoot], '404.html')
        if File.exist?(path)
          res.body = File.read(path)
          res['content-type'] = 'text/html'
        else
          raise HTTPStatus::NotFound
        end
      end
    end
  end
end