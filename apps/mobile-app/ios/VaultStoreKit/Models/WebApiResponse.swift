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

    /// Initialize a new WebApiResponse
    public init(statusCode: Int, body: String, headers: [String: String]) {
        self.statusCode = statusCode
        self.body = body
        self.headers = headers
    }
}
