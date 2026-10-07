/**
 * Response object from a WebAPI request containing status code, body, and headers
 */
public struct WebApiResponse {
    /// The status code of the response
    public let statusCode: Int
    /// The body of the response
    public let body: String
    /// The headers of the response
    public let headers: [String: String]
    /// The body as raw bytes, set on a successful binary response when the request asked for raw bytes
    public let bodyData: Data?

    /// Initialize a new WebApiResponse
    public init(statusCode: Int, body: String, headers: [String: String], bodyData: Data? = nil) {
        self.statusCode = statusCode
        self.body = body
        self.headers = headers
        self.bodyData = bodyData
    }
}
